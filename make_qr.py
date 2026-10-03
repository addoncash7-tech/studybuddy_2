"""
Generate qr.png: a UPI payment QR with the amount (Rs. 250) pre-filled.

Usage:
    pip install qrcode[pil]
    python make_qr.py yourupiid@bank "Your Name"

If you already have a QR image from your UPI app (GPay / PhonePe / Paytm / bank),
you can skip this script and just save that image as qr.png in this folder.
"""
import sys
from urllib.parse import quote

import qrcode

AMOUNT = 250

if len(sys.argv) < 2:
    sys.exit('Usage: python make_qr.py yourupiid@bank "Your Name"')

upi_id = sys.argv[1]
name = sys.argv[2] if len(sys.argv) > 2 else "Study Buddy"
upi_link = f"upi://pay?pa={quote(upi_id)}&pn={quote(name)}&am={AMOUNT}&cu=INR&tn={quote('Study Buddy access')}"

qrcode.make(upi_link).save("qr.png")
print("Saved qr.png for", upi_id, "- amount Rs.", AMOUNT)
