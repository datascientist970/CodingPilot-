CREATE TABLE users (
    id INT,
    name VARCHAR(100)
);

CREATE PROCEDURE cleanup_old_users()
BEGIN
    DELETE FROM users;
END;

SELECT * FROM users;

UPDATE users SET name = 'x';

CREATE PROCEDURE used_proc()
BEGIN
    SELECT id FROM users WHERE id = 1;
END;

SELECT * FROM used_proc();
