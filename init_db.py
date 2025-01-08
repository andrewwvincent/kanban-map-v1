import sqlite3

def init_db():
    conn = sqlite3.connect('data/targets.db')
    
    with open('schema.sql') as f:
        conn.executescript(f.read())
    
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
    print("Database initialized successfully")
