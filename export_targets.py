import sqlite3
import csv
from datetime import datetime
import os

def export_targets():
    # Connect to the database
    db_path = os.path.join(os.path.dirname(__file__), 'data', 'targets.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get current timestamp for filename
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_file = f'targets_export_{timestamp}.csv'
    
    # Get all data from targets table
    cursor.execute('SELECT * FROM targets')
    rows = cursor.fetchall()
    
    # Get column names
    cursor.execute('PRAGMA table_info(targets)')
    columns = [col[1] for col in cursor.fetchall()]
    
    # Write to CSV
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(columns)  # Write headers
        writer.writerows(rows)    # Write data
    
    print(f'Data exported to {output_file}')
    conn.close()

if __name__ == '__main__':
    export_targets()
