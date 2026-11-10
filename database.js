
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Use Render's persistent disk when deployed.
// Use the project folder when running locally.
const dbPath = process.env.DB_FILE ||
    path.join(__dirname, "eventpilot.db");

// Create the directory if it does not exist.
fs.mkdirSync(path.dirname(dbPath), {
    recursive: true
});

const db = new Database(dbPath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// SQLite compatibility layer
const pool = {
    async query(sql, params = []) {
        const sqliteSQL = sql.replace(/\$\d+/g, "?");
        const statement = db.prepare(sqliteSQL);

        if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sqliteSQL)) {
            const rows = statement.all(...params);

            return {
                rows,
                rowCount: rows.length
            };
        }

        if (/\bRETURNING\b/i.test(sqliteSQL)) {
            const rows = statement.all(...params);

            return {
                rows,
                rowCount: rows.length
            };
        }

        const result = statement.run(...params);

        return {
            rows: [],
            rowCount: result.changes,
            lastInsertRowid: result.lastInsertRowid
        };
    }
};

async function initializeDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'member',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            event_date TEXT NOT NULL,
            location TEXT,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            deadline TEXT,
            status TEXT DEFAULT 'Pending',
            assigned_to INTEGER,
            event_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assigned_to) REFERENCES users(id),
            FOREIGN KEY (event_id) REFERENCES events(id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);

    console.log("EventPilot SQLite database is ready!");
    console.log("Database location:", dbPath);
}

module.exports = {
    db,
    pool,
    initializeDatabase
};
