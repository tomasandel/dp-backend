-- Normalize log_id to padded base64 (add trailing '=' padding where missing)
-- Base64 strings must have length divisible by 4; pad with '=' as needed.
UPDATE sths
SET log_id = log_id || REPEAT('=', (4 - LENGTH(log_id) % 4) % 4)
WHERE LENGTH(log_id) % 4 != 0;
