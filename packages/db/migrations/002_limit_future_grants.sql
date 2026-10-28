-- Correct the initial default privilege: future tables do not grant runtime UPDATE by default.
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA app REVOKE UPDATE ON TABLES FROM app_rw;
