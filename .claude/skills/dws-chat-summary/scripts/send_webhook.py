#!/usr/bin/env python3
"""Send a message to DingTalk group via custom robot webhook with signature."""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


def load_dotenv():
    env_path = Path(__file__).resolve().parents[4] / ".env"
    if not env_path.exists():
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


def send_webhook(text: str, title: str = None, msgtype: str = "text", at_all: bool = False):
    load_dotenv()
    token = os.environ.get("DWS_WEBHOOK_TOKEN")
    secret = os.environ.get("DWS_WEBHOOK_SECRET")

    if not token:
        print("Error: DWS_WEBHOOK_TOKEN not set in environment", file=sys.stderr)
        sys.exit(1)
    if not secret:
        print("Error: DWS_WEBHOOK_SECRET not set in environment", file=sys.stderr)
        sys.exit(1)

    timestamp = str(int(time.time() * 1000))
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(
        secret.encode(), string_to_sign.encode(), digestmod=hashlib.sha256
    ).digest()
    sign = urllib.parse.quote(base64.b64encode(hmac_code).decode())

    url = f"https://oapi.dingtalk.com/robot/send?access_token={token}&timestamp={timestamp}&sign={sign}"

    payload = {"msgtype": msgtype}
    if msgtype == "text":
        payload["text"] = {"content": text}
    elif msgtype == "markdown":
        payload["markdown"] = {"title": title or "Message", "text": text}

    if at_all:
        payload["at"] = {"isAtAll": True}

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read().decode())
        if result.get("errcode") == 0:
            print("Message sent successfully")
        else:
            print(f"Error: {result}", file=sys.stderr)
            sys.exit(1)
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send DingTalk webhook message")
    parser.add_argument("--text", required=True, help="Message content")
    parser.add_argument("--title", help="Message title (required for markdown)")
    parser.add_argument("--msgtype", default="text", choices=["text", "markdown"])
    parser.add_argument("--at-all", action="store_true", help="@all members")
    args = parser.parse_args()
    send_webhook(args.text, args.title, args.msgtype, args.at_all)
