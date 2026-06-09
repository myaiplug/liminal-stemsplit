#!/usr/bin/env python3
"""
StemSplit License Key Generator

This tool generates cryptographically signed license keys for StemSplit.
Keep the PRIVATE KEY secret - only the public key is embedded in the app.

Usage:
    python license_generator.py --setup           # Generate new keypair (first time only)
    python license_generator.py --generate EMAIL TIER DAYS  # Create license key
    
Example:
    python license_generator.py --setup
    python license_generator.py --generate user@example.com pro 365
"""

import argparse
import base64
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
except ImportError:
    print("Missing cryptography library. Install with: pip install cryptography")
    sys.exit(1)

# Key storage location (keep these secret!)
KEYS_DIR = Path(__file__).parent / ".license_keys"
PRIVATE_KEY_FILE = KEYS_DIR / "private_key.pem"
PUBLIC_KEY_FILE = KEYS_DIR / "public_key.pem"


def generate_keypair():
    """Generate a new Ed25519 keypair for license signing."""
    KEYS_DIR.mkdir(exist_ok=True)
    
    if PRIVATE_KEY_FILE.exists():
        print("WARNING: Keys already exist!")
        response = input("Overwrite existing keys? This will INVALIDATE all existing licenses! (yes/no): ")
        if response.lower() != "yes":
            print("Aborted.")
            return
    
    # Generate new keypair
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    
    # Save private key (KEEP SECRET!)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    PRIVATE_KEY_FILE.write_bytes(private_pem)
    
    # Save public key
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    PUBLIC_KEY_FILE.write_bytes(public_pem)
    
    # Get raw public key bytes for embedding in app
    raw_public_key = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )
    public_key_b64 = base64.standard_b64encode(raw_public_key).decode()
    
    print("\n" + "="*60)
    print("KEYPAIR GENERATED SUCCESSFULLY")
    print("="*60)
    print(f"\nPrivate key saved to: {PRIVATE_KEY_FILE}")
    print(f"Public key saved to: {PUBLIC_KEY_FILE}")
    print("\n⚠️  IMPORTANT: Keep the private key SECRET!")
    print("   Add .license_keys/ to .gitignore immediately!")
    print("\n" + "-"*60)
    print("PUBLIC KEY FOR main.rs (replace LICENSE_PUBLIC_KEY constant):")
    print("-"*60)
    print(f'\nconst LICENSE_PUBLIC_KEY: &str = "{public_key_b64}";')
    print("\n" + "="*60)


def load_private_key():
    """Load the private key from file."""
    if not PRIVATE_KEY_FILE.exists():
        print("ERROR: No private key found. Run --setup first.")
        sys.exit(1)
    
    private_pem = PRIVATE_KEY_FILE.read_bytes()
    return serialization.load_pem_private_key(private_pem, password=None)


def generate_license(email: str, tier: str, days: int):
    """Generate a signed license key."""
    tier = tier.lower()
    if tier not in ["free", "pro", "enterprise"]:
        print(f"ERROR: Invalid tier '{tier}'. Must be: free, pro, enterprise")
        sys.exit(1)
    
    if days < 1:
        print("ERROR: Days must be at least 1")
        sys.exit(1)
    
    private_key = load_private_key()
    
    # Calculate expiry timestamp
    expiry = datetime.utcnow() + timedelta(days=days)
    expiry_unix = int(expiry.timestamp())
    
    # Create email hash (first 4 bytes = 8 hex chars)
    email_hash = hashlib.sha256(email.lower().encode()).hexdigest()[:8]
    
    # Data to sign
    signed_data = f"{tier}:{email_hash}:{expiry_unix}"
    
    # Sign it
    signature = private_key.sign(signed_data.encode())
    signature_b64 = base64.standard_b64encode(signature).decode()
    
    # Build license key
    license_key = f"STEM-{tier.upper()}-{email_hash}-{expiry_unix}-{signature_b64}"
    
    print("\n" + "="*60)
    print("LICENSE KEY GENERATED")
    print("="*60)
    print(f"\nEmail: {email}")
    print(f"Tier: {tier}")
    print(f"Expires: {expiry.strftime('%Y-%m-%d %H:%M UTC')} ({days} days)")
    print("\n" + "-"*60)
    print("LICENSE KEY:")
    print("-"*60)
    print(f"\n{license_key}")
    print("\n" + "="*60)
    
    # Also save to a JSON file for reference
    license_record = {
        "email": email,
        "tier": tier,
        "created": datetime.utcnow().isoformat(),
        "expires": expiry.isoformat(),
        "expiry_unix": expiry_unix,
        "key": license_key
    }
    
    licenses_file = KEYS_DIR / "issued_licenses.json"
    licenses = []
    if licenses_file.exists():
        licenses = json.loads(licenses_file.read_text())
    licenses.append(license_record)
    licenses_file.write_text(json.dumps(licenses, indent=2))
    print(f"License record saved to: {licenses_file}")


def main():
    parser = argparse.ArgumentParser(
        description="StemSplit License Key Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --setup                          # Generate new keypair (first time)
  %(prog)s --generate user@email.com pro 365  # Create 1-year Pro license
  %(prog)s --generate test@test.com enterprise 30  # Create 30-day Enterprise trial
        """
    )
    
    parser.add_argument("--setup", action="store_true", help="Generate new Ed25519 keypair")
    parser.add_argument("--generate", nargs=3, metavar=("EMAIL", "TIER", "DAYS"),
                       help="Generate license key (tier: free/pro/enterprise)")
    
    args = parser.parse_args()
    
    if args.setup:
        generate_keypair()
    elif args.generate:
        email, tier, days = args.generate
        generate_license(email, tier, int(days))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
