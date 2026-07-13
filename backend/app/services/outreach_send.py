from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path

import httpx

from app.db import load_root_env

logger = logging.getLogger(__name__)
LOG_DIR = Path(__file__).resolve().parents[2] / "logs"


class OutreachSendError(RuntimeError):
    pass


def _smtp_configured() -> bool:
    load_root_env()
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_FROM"))


def _twilio_configured() -> bool:
    load_root_env()
    return bool(
        os.getenv("TWILIO_ACCOUNT_SID")
        and os.getenv("TWILIO_AUTH_TOKEN")
        and os.getenv("TWILIO_FROM_NUMBER")
    )


def _log_outreach(channel: str, recipient: str, subject: str, body: str) -> dict:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / "outreach.log"
    entry = (
        f"\n---\nchannel={channel}\nrecipient={recipient}\nsubject={subject}\n"
        f"{body}\n"
    )
    log_path.write_text(log_path.read_text(encoding="utf-8") + entry if log_path.exists() else entry, encoding="utf-8")
    return {"channel": channel, "recipient": recipient, "mode": "logged", "detail": f"Saved to {log_path}"}


def send_email(*, to_email: str, subject: str, body: str) -> dict:
    load_root_env()
    recipient = str(to_email or "").strip()
    if not recipient:
        raise OutreachSendError("Recipient email is required.")

    if not _smtp_configured():
        return _log_outreach("email", recipient, subject, body)

    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    sender = os.getenv("SMTP_FROM", "").strip()

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(body)

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        if os.getenv("SMTP_USE_TLS", "true").lower() != "false":
            smtp.starttls()
        if user and password:
            smtp.login(user, password)
        smtp.send_message(message)

    return {"channel": "email", "recipient": recipient, "mode": "smtp", "detail": "Email sent"}


def send_sms(*, to_phone: str, body: str) -> dict:
    load_root_env()
    recipient = str(to_phone or "").strip()
    if not recipient:
        raise OutreachSendError("Recipient phone number is required.")

    if not _twilio_configured():
        return _log_outreach("sms", recipient, "SMS outreach", body)

    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_number = os.getenv("TWILIO_FROM_NUMBER", "").strip()
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"

    with httpx.Client(timeout=20.0) as client:
        response = client.post(
            url,
            auth=(account_sid, auth_token),
            data={"To": recipient, "From": from_number, "Body": body[:1500]},
        )

    if not response.is_success:
        raise OutreachSendError(response.text or "Twilio SMS request failed")

    return {"channel": "sms", "recipient": recipient, "mode": "twilio", "detail": "SMS sent"}


def dispatch_outreach(
    *,
    channels: list[str],
    to_email: str | None,
    to_phone: str | None,
    subject: str,
    body: str,
) -> list[dict]:
    results: list[dict] = []
    normalized = {str(channel).strip().lower() for channel in channels if channel}

    if "email" in normalized:
        results.append(send_email(to_email=to_email or "", subject=subject, body=body))
    if "sms" in normalized:
        sms_body = body if len(body) <= 320 else f"{body[:300]}..."
        results.append(send_sms(to_phone=to_phone or "", body=sms_body))

    if not results:
        raise OutreachSendError("Select at least one channel: email or sms.")

    return results
