# HIT Civil Engineering – Digital Library: Firestore Security Specification

## 1. Data Invariants
1. **Default Deny**: Any unmatched path in Firestore is denied for read and write.
2. **Verified Identity**: All writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Zero Self-Privilege Escalation**: Regular users cannot assign themselves `SUPER_ADMIN` or `LIBRARIAN` roles or alter their `role` field on `users/{userId}`.
4. **PII Isolation**: User emails, phones, and member IDs live in `users/{userId}/private/{docId}`, readable only by the owner (`request.auth.uid == userId`) or a verified staff admin (`isStaff()`).
5. **Path Variable Hardening**: Single-document `get`, `create`, `update`, and `delete` enforce `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
6. **Immutable Fields & Temporal Integrity**: `createdAt` must equal `request.time` on create and never change on update; `updatedAt` must equal `request.time` on update.
7. **Terminal State Locking**: Returned circulation transactions (`status == 'RETURNED'`) and finalized acquisition requests (`status == 'PURCHASED'` or `'REJECTED'`) cannot be mutated by non-admins.
8. **Secure List Queries**: `allow list` on `circulations`, `reservations`, and `acquisitionRequests` enforces `resource.data.<ownerField> == request.auth.uid` (or `isStaff()`).

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Book Creation**: `create /books/b1` with `auth = null`.
2. **Unverified Email Spoofing**: `write /settings/main` with `email = 'patrasatyabrata8@gmail.com'` and `email_verified = false`.
3. **Self-Assigned Super Admin**: `create /users/u1` with `{ uid: 'u1', role: 'SUPER_ADMIN', ... }`.
4. **Shadow Field Injection**: `create /reservations/r1` including extra ghost field `{ isApproved: true }`.
5. **Cross-User PII Read**: `get /users/victim/private/info` as another non-admin user `attacker`.
6. **Identity Spoofing on Reservation**: `create /reservations/r2` as `u1` with `{ userId: 'u2', ... }`.
7. **Resource Poisoning via Oversized ID**: `create /books/<200-char-invalid-id>` with illegal characters.
8. **Value Poisoning on Update**: `update /reservations/r1` setting `status` to a 10KB string or boolean.
9. **Immutable Timestamp Tampering**: `update /reservations/r1` modifying `createdAt`.
10. **Client-Forged Timestamp**: `create /acquisitionRequests/a1` with `createdAt` != `request.time`.
11. **Terminal State Mutation**: Student updating a `CANCELLED` reservation back to `ACTIVE`.
12. **Unscoped Collection Scraping**: Student listing `/circulations` without filtering `borrowerUid == request.auth.uid`.
