"""
Encryption Utility Module
Provides AES-256 encryption/decryption and SHA-256 hashing for sensitive data.

Usage:
    from app.common.encryption import encrypt, decrypt, hash_for_search
    
    # Encrypt/decrypt sensitive data
    encrypted = encrypt("sensitive_value")
    decrypted = decrypt(encrypted)
    
    # Hash for searchable fields (email, phone)
    hashed = hash_for_search("user@example.com")
"""
import os
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken


class EncryptionError(Exception):
    """Raised when encryption/decryption fails."""
    pass


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    """
    Get Fernet instance with encryption key from environment.
    Cached for performance.
    
    The key must be a URL-safe base64-encoded 32-byte key.
    Generate one using: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    """
    key = os.environ.get('ENCRYPTION_KEY')
    if not key:
        raise EncryptionError(
            "ENCRYPTION_KEY environment variable is not set. "
            "Generate one using: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    try:
        return Fernet(key.encode())
    except Exception as e:
        raise EncryptionError(f"Invalid ENCRYPTION_KEY: {e}")


def encrypt(value: str) -> str:
    """
    Encrypt a string value using AES-256 (Fernet).
    
    Args:
        value: Plain text string to encrypt
        
    Returns:
        Base64-encoded encrypted string
        
    Raises:
        EncryptionError: If encryption fails
    """
    if not value:
        return value
    
    try:
        fernet = _get_fernet()
        encrypted = fernet.encrypt(value.encode('utf-8'))
        return encrypted.decode('utf-8')
    except Exception as e:
        raise EncryptionError(f"Encryption failed: {e}")


def decrypt(encrypted_value: str) -> str:
    """
    Decrypt an encrypted string value.
    
    Args:
        encrypted_value: Base64-encoded encrypted string
        
    Returns:
        Decrypted plain text string
        
    Raises:
        EncryptionError: If decryption fails (invalid key or corrupted data)
    """
    if not encrypted_value:
        return encrypted_value
    
    try:
        fernet = _get_fernet()
        decrypted = fernet.decrypt(encrypted_value.encode('utf-8'))
        return decrypted.decode('utf-8')
    except InvalidToken:
        raise EncryptionError("Decryption failed: Invalid token or wrong encryption key")
    except Exception as e:
        raise EncryptionError(f"Decryption failed: {e}")


def hash_for_search(value: str) -> str:
    """
    Create a SHA-256 hash of a value for searchable encrypted fields.
    
    This allows searching encrypted fields without decrypting:
    - Store both encrypted value and hash
    - Query by hash, return decrypted value
    
    Args:
        value: Plain text string to hash
        
    Returns:
        Hex-encoded SHA-256 hash (64 characters)
    """
    if not value:
        return value
    
    # Normalize: lowercase and strip whitespace for consistent hashing
    normalized = value.lower().strip()
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def generate_encryption_key() -> str:
    """
    Generate a new Fernet encryption key.
    
    Returns:
        URL-safe base64-encoded 32-byte key
    """
    return Fernet.generate_key().decode('utf-8')


# Type for SQLAlchemy hybrid properties
class EncryptedField:
    """
    Descriptor for encrypted model fields.
    
    Usage in model:
        class User(db.Model):
            _email_encrypted = db.Column(db.Text)
            _email_hash = db.Column(db.String(64), index=True)
            
            email = EncryptedField('_email_encrypted', '_email_hash', searchable=True)
    """
    
    def __init__(self, encrypted_column: str, hash_column: str = None, searchable: bool = False):
        self.encrypted_column = encrypted_column
        self.hash_column = hash_column
        self.searchable = searchable
    
    def __set_name__(self, owner, name):
        self.public_name = name
    
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        encrypted_value = getattr(obj, self.encrypted_column)
        if encrypted_value:
            try:
                return decrypt(encrypted_value)
            except EncryptionError:
                return None
        return None
    
    def __set__(self, obj, value):
        if value:
            setattr(obj, self.encrypted_column, encrypt(value))
            if self.searchable and self.hash_column:
                setattr(obj, self.hash_column, hash_for_search(value))
        else:
            setattr(obj, self.encrypted_column, None)
            if self.hash_column:
                setattr(obj, self.hash_column, None)
