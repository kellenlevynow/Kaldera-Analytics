#!/usr/bin/env python3
"""Configure Cloudflare Access for the private reports and wire the Pages project to it.

Creates (or reuses) a One-time PIN identity provider, a self-hosted Access application
covering audit.kaldera-analytics.com/reports, an Allow policy for the given emails, and
sets REPORT_ACCESS_MODE, ACCESS_TEAM_DOMAIN and ACCESS_AUD on the Pages project so the
report gate verifies Access tokens. Idempotent: re-running updates the policy's emails.

Usage:
  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
    python3 scripts/setup-access.py --email owner@example.com --email client@example.com \
    [--host audit.kaldera-analytics.com] [--pages-project kaldera-audit] [--session 24h]

Token permissions needed: Account > Access: Apps and Policies (Edit),
Account > Access: Organizations, Identity Providers, and Groups (Edit),
Account > Cloudflare Pages (Edit). Emails are never written to disk by this script.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"


def call(method, path, token, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": f"Bearer {token}", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        data = json.load(e)
    if not data.get("success"):
        sys.exit(f"{method} {path} failed: {json.dumps(data.get('errors'), indent=2)}")
    return data["result"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--email", action="append", required=True, help="address allowed to open reports; repeat per person")
    p.add_argument("--host", default="audit.kaldera-analytics.com")
    p.add_argument("--path", default="reports")
    p.add_argument("--pages-project", default="kaldera-audit")
    p.add_argument("--session", default="24h")
    p.add_argument("--app-name", default="Kaldera Analytics reports")
    a = p.parse_args()
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not acct:
        sys.exit("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.")
    base = f"/accounts/{acct}/access"

    org = call("GET", f"{base}/organizations", token)
    team_domain = org["auth_domain"]
    print(f"Zero Trust team domain: {team_domain}")

    idps = call("GET", f"{base}/identity_providers", token)
    otp = next((i for i in idps if i["type"] == "onetimepin"), None)
    if not otp:
        otp = call("POST", f"{base}/identity_providers", token, {"name": "One-time PIN", "type": "onetimepin", "config": {}})
        print("Created One-time PIN identity provider")
    else:
        print("One-time PIN identity provider present")

    domain = f"{a.host}/{a.path}"
    apps = call("GET", f"{base}/apps", token)
    app = next((x for x in apps if x.get("domain") == domain), None)
    spec = {
        "name": a.app_name, "type": "self_hosted", "domain": domain, "session_duration": a.session,
        "allowed_idps": [otp["id"]], "auto_redirect_to_identity": True, "app_launcher_visible": False,
        "http_only_cookie_attribute": True, "same_site_cookie_attribute": "lax", "enable_binding_cookie": False,
        "skip_interstitial": True,
    }
    if app:
        app = call("PUT", f"{base}/apps/{app['id']}", token, spec)
        print(f"Updated Access application {app['id']} for {domain}")
    else:
        app = call("POST", f"{base}/apps", token, spec)
        print(f"Created Access application {app['id']} for {domain}")

    include = [{"email": {"email": e.strip().lower()}} for e in a.email]
    policies = call("GET", f"{base}/apps/{app['id']}/policies", token)
    pol = next((x for x in policies if x["name"] == "Allowed readers"), None)
    body = {"name": "Allowed readers", "decision": "allow", "include": include, "exclude": [], "require": [], "precedence": 1}
    if pol:
        call("PUT", f"{base}/apps/{app['id']}/policies/{pol['id']}", token, body)
        print(f"Updated policy with {len(include)} address(es)")
    else:
        call("POST", f"{base}/apps/{app['id']}/policies", token, body)
        print(f"Created policy with {len(include)} address(es)")

    aud = app["aud"]
    proj_path = f"/accounts/{acct}/pages/projects/{a.pages_project}"
    proj = call("GET", proj_path, token)
    env = proj.get("deployment_configs", {}).get("production", {}).get("env_vars") or {}
    env.update({
        "REPORT_ACCESS_MODE": {"value": "access"},
        "ACCESS_TEAM_DOMAIN": {"value": team_domain},
        "ACCESS_AUD": {"value": aud},
    })
    call("PATCH", proj_path, token, {"deployment_configs": {"production": {"env_vars": env}}})
    print(f"Pages project {a.pages_project}: REPORT_ACCESS_MODE=access, ACCESS_TEAM_DOMAIN, ACCESS_AUD set")
    print("Trigger a new deployment (push to main or retry the latest deploy) so the Functions pick up the variables.")
    print(f"Verify: curl -sI https://{domain}/ should return a 302 to https://{team_domain}/... and a signed-in reader should get 200.")


if __name__ == "__main__":
    main()
