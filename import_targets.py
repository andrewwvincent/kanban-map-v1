import sqlite3
import csv
import sys
import os

def import_targets(csv_file):
    # Connect to the database
    db_path = os.path.join(os.path.dirname(__file__), 'data', 'targets.db')
    print(f"Connecting to database at: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Read CSV file
        print(f"Reading CSV file: {csv_file}")
        with open(csv_file, 'r', encoding='utf-8') as f:
            csv_reader = csv.reader(f)
            headers = next(csv_reader)  # Get headers
            print(f"CSV Headers: {headers}")
            
            # Get current table structure
            cursor.execute('PRAGMA table_info(targets)')
            table_info = cursor.fetchall()
            table_columns = [col[1] for col in table_info]
            print(f"Database columns: {table_columns}")
            
            # Verify headers match database columns
            if set(headers) != set(table_columns):
                print("Warning: CSV headers don't match database columns!")
                print(f"Missing in CSV: {set(table_columns) - set(headers)}")
                print(f"Extra in CSV: {set(headers) - set(table_columns)}")
                raise ValueError("CSV structure doesn't match database structure")
            
            # Clear existing data
            print("Clearing existing data...")
            cursor.execute('DELETE FROM targets')
            
            # Prepare insert statement with the correct number of placeholders
            placeholders = ','.join(['?' for _ in headers])
            insert_query = f'INSERT INTO targets ({",".join(headers)}) VALUES ({placeholders})'
            print(f"Insert query: {insert_query}")
            
            # Insert new data
            row_count = 0
            for row in csv_reader:
                cursor.execute(insert_query, row)
                row_count += 1
            
            # Commit changes
            conn.commit()
            print(f"Successfully imported {row_count} rows")
            
            # Verify data
            cursor.execute('SELECT COUNT(*) FROM targets')
            final_count = cursor.fetchone()[0]
            print(f"Final row count in database: {final_count}")
            
            # Print a few sample rows
            print("\nSample rows from database:")
            cursor.execute('SELECT * FROM targets LIMIT 3')
            sample_rows = cursor.fetchall()
            for row in sample_rows:
                print(row)
            
    except Exception as e:
        print(f'Error importing data: {str(e)}')
        conn.rollback()
    finally:
        conn.close()

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python import_targets.py <csv_file>')
        print('Example: python import_targets.py targets_import.csv')
        sys.exit(1)
    
    import_targets(sys.argv[1])
