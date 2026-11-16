-- Bind each OAuth attempt to the browser that started it (SHA-256 of a
-- random value held in a short-lived HttpOnly cookie), so a sign-in or
-- account-connect link can't be completed in someone else's browser.
ALTER TABLE oauth_states ADD COLUMN browser_hash TEXT;
