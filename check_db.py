import sqlite3
import os

def check_database():
    db_path = os.path.join(os.path.dirname(__file__), 'data', 'targets.db')
    print(f"Checking database at: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get table structure
    cursor.execute('PRAGMA table_info(targets)')
    columns = cursor.fetchall()
    print("\nTable structure:")
    for col in columns:
        print(f"Column {col[0]}: {col[1]} ({col[2]})")
    
    # Get row count
    cursor.execute('SELECT COUNT(*) FROM targets')
    count = cursor.fetchone()[0]
    print(f"\nTotal rows: {count}")
    
    # Get sample data
    print("\nSample rows:")
    cursor.execute('SELECT * FROM targets LIMIT 3')
    rows = cursor.fetchall()
    for row in rows:
        print(row)
    
    # Check for Westlake specifically
    print("\nSearching for Westlake:")
    cursor.execute("SELECT * FROM targets WHERE organization LIKE '%Westlake%'")
    westlake_rows = cursor.fetchall()
    for row in westlake_rows:
        print(row)
    
    conn.close()

if __name__ == '__main__':
    check_database()
