from flask import Flask, send_from_directory, jsonify, request
import os
import sqlite3
import shutil
from datetime import datetime
import json

app = Flask(__name__, static_folder='.', static_url_path='')

def get_db_connection():
    conn = sqlite3.connect('data/targets.db')
    conn.row_factory = sqlite3.Row
    return conn

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route('/')
def root():
    return send_from_directory('.', 'index_db.html')

@app.route('/index_db.html')
def index_db():
    return send_from_directory('.', 'index_db.html')

@app.route('/kanban.html')
def kanban():
    return send_from_directory('.', 'kanban.html')

@app.route('/dashboard')
def dashboard():
    return send_from_directory('.', 'dashboard.html')

@app.route('/api/targets')
def get_targets():
    conn = None
    try:
        # First, let's check if the database file exists
        if not os.path.exists('data/targets.db'):
            print("Database file not found!")
            return jsonify({'error': 'Database file not found'}), 500
            
        conn = get_db_connection()
        
        # First, let's count how many records we have
        count = conn.execute('SELECT COUNT(*) FROM targets').fetchone()[0]
        print(f"Total records in targets table: {count}")
        
        # Now get the actual data
        targets = conn.execute('''
            SELECT t.organization, t.address, t.phone, t.website, t.population, 
                   t.median_income, t.status, t.latitude, t.longitude,
                   z.grade
            FROM targets t
            LEFT JOIN zip_data z ON t.region = z.zip_code
        ''').fetchall()
        
        # Convert to list for debugging
        result = [dict(row) for row in targets]
        print(f"Number of targets returned: {len(result)}")
        
        if len(result) == 0:
            # Let's check what tables exist
            tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            print(f"Tables in database: {[t[0] for t in tables]}")
            
            # Check if targets table exists and has the expected schema
            schema = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='targets'").fetchone()
            if schema:
                print(f"Targets table schema: {schema[0]}")
            
            # Check a sample of raw data
            try:
                sample = conn.execute("SELECT * FROM targets LIMIT 1").fetchall()
                print(f"Sample data: {sample}")
            except Exception as e:
                print(f"Error getting sample data: {e}")
        
        return jsonify(result)
    except sqlite3.Error as e:
        print(f"SQLite error: {e}")
        return jsonify({'error': f'Database error: {str(e)}'}), 500
    except Exception as e:
        print(f"Error getting targets: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/kanban_data')
def get_kanban_data():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 
                t.organization,
                t.address,
                t.phone,
                COALESCE(t.status, 'not-contacted') as status,
                t.population,
                t.median_income,
                z.grade
            FROM targets t
            LEFT JOIN zip_data z ON t.region = z.zip_code
        ''')
        
        targets = []
        for row in cursor.fetchall():
            targets.append({
                'organization': row[0],
                'address': row[1],
                'phone': row[2] if row[2] else 'N/A',
                'status': row[3],
                'population': row[4],
                'median_income': row[5],
                'zip_grade': row[6] if row[6] else 'N/A'
            })
        return jsonify(targets)
    except Exception as e:
        print(f"Error getting kanban data: {e}")
        return str(e), 500
    finally:
        conn.close()

@app.route('/api/update_status', methods=['POST'])
def update_status():
    data = request.json
    organization = data.get('organization')
    new_status = data.get('status')
    
    if not organization or not new_status:
        return jsonify({'error': 'Missing organization or status'}), 400

    conn = get_db_connection()
    try:
        # Get current status
        current = conn.execute(
            'SELECT status FROM targets WHERE organization = ?',
            (organization,)
        ).fetchone()
        
        if not current:
            return jsonify({'error': 'Organization not found'}), 404
        
        old_status = current[0]
        
        # Update status
        conn.execute('''
            UPDATE targets 
            SET status = ?, last_updated = CURRENT_TIMESTAMP 
            WHERE organization = ?
        ''', (new_status, organization))
        
        # Log the change
        conn.execute('''
            INSERT INTO activity_log (organization, old_status, new_status)
            VALUES (?, ?, ?)
        ''', (organization, old_status, new_status))
        
        conn.commit()
        print(f"Updated status for {organization}: {old_status} -> {new_status}")
        return jsonify({'success': True, 'old_status': old_status, 'new_status': new_status})
    
    except Exception as e:
        conn.rollback()
        print(f"Error updating status: {e}")
        return str(e), 500
    finally:
        conn.close()

@app.route('/api/zips')
def get_zips():
    conn = get_db_connection()
    try:
        zips = conn.execute('''
            SELECT zip_code, geographic_area, households, total_pop,
                   median_income, grade, latitude, longitude,
                   cluster_a_5mi, cluster_a_10mi, cluster_ab_5mi, 
                   cluster_ab_10mi, cluster_abc_5mi, cluster_abc_10mi,
                   cluster_bc_5mi, cluster_bc_10mi
            FROM zip_data
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ''').fetchall()
        print(f"Retrieved {len([dict(row) for row in zips])} ZIP codes")
        return jsonify([dict(row) for row in zips])
    except Exception as e:
        print(f"Error getting ZIP data: {e}")
        return str(e), 500
    finally:
        conn.close()

@app.route('/api/clusters/<analysis_type>')
def get_clusters(analysis_type):
    conn = get_db_connection()
    try:
        cluster_col = f'cluster_{analysis_type.lower()}'
        
        # Get all ZIPs that belong to clusters of this type
        query = f'''
        SELECT zip_code, latitude, longitude, {cluster_col}, 
               total_pop, median_income, grade
        FROM zip_data 
        WHERE {cluster_col} IS NOT NULL
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        '''
        
        results = conn.execute(query).fetchall()
        
        # Group ZIPs by cluster
        clusters = {}
        for row in results:
            cluster_name = row[cluster_col]
            if cluster_name not in clusters:
                clusters[cluster_name] = []
            clusters[cluster_name].append({
                'zip': row['zip_code'],
                'lat': row['latitude'],
                'lng': row['longitude'],
                'total_pop': row['total_pop'],
                'median_income': row['median_income'],
                'grade': row['grade']
            })
        
        print(f"Retrieved {len(clusters)} clusters for analysis type {analysis_type}")
        return jsonify(clusters)
    except Exception as e:
        print(f"Error getting clusters: {e}")
        return str(e), 500
    finally:
        conn.close()

@app.route('/api/notes/<path:target_id>', methods=['GET'])
def get_notes(target_id):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM notes WHERE target_id = ? ORDER BY timestamp DESC', (target_id,))
        notes = []
        for row in cursor.fetchall():
            notes.append({
                'id': row[0],
                'target_id': row[1],
                'content': row[2],
                'timestamp': row[3]
            })
        return jsonify(notes)
    except Exception as e:
        print(f"Error getting notes: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/notes', methods=['POST'])
def add_note():
    data = request.json
    if not data or 'target_id' not in data or 'content' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        # First check if the target exists in the notes table
        cursor.execute('SELECT 1 FROM notes WHERE target_id = ? LIMIT 1', (data['target_id'],))
        target_exists = cursor.fetchone() is not None
        
        if not target_exists:
            print(f"Target {data['target_id']} is new to notes table")
            
        # Add the note
        cursor.execute(
            'INSERT INTO notes (target_id, content, timestamp) VALUES (?, ?, datetime("now", "localtime"))',
            (data['target_id'], data['content'])
        )
        conn.commit()
        note_id = cursor.lastrowid
        
        # Get the newly created note
        cursor.execute('SELECT * FROM notes WHERE id = ?', (note_id,))
        note = dict(cursor.fetchone())
        return jsonify(note)
    except Exception as e:
        print(f"Error adding note: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/notes/<int:note_id>', methods=['DELETE'])
def delete_note(note_id):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        # First check if the note exists
        cursor.execute('SELECT * FROM notes WHERE id = ?', (note_id,))
        note = cursor.fetchone()
        if not note:
            return jsonify({'error': 'Note not found'}), 404
            
        cursor.execute('DELETE FROM notes WHERE id = ?', (note_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        print(f"Error deleting note: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/activity_log', methods=['GET'])
def get_activity_log():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 50')
        activities = [dict(row) for row in cursor.fetchall()]
        return jsonify(activities)
    except Exception as e:
        print(f"Error getting activity log: {e}")
        return str(e), 500
    finally:
        conn.close()

@app.route('/api/dashboard/summary')
def get_dashboard_summary():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        # Get status counts
        cursor.execute('''
            SELECT 
                COALESCE(status, 'not-contacted') as status,
                COUNT(*) as count,
                SUM(population) as total_population,
                AVG(median_income) as avg_income
            FROM targets
            GROUP BY COALESCE(status, 'not-contacted')
        ''')
        
        status_summary = {}
        for row in cursor.fetchall():
            status_summary[row[0]] = {
                'count': row[1],
                'total_population': row[2],
                'avg_income': row[3]
            }
            
        # Get grade distribution
        cursor.execute('''
            SELECT 
                z.grade,
                COUNT(*) as count
            FROM targets t
            LEFT JOIN zip_data z ON t.region = z.zip_code
            GROUP BY z.grade
        ''')
        
        grade_summary = {}
        for row in cursor.fetchall():
            if row[0]:  # Only include non-null grades
                grade_summary[row[0]] = row[1]
        
        return jsonify({
            'status_summary': status_summary,
            'grade_summary': grade_summary
        })
    except Exception as e:
        print(f"Error getting dashboard summary: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/dashboard/status/<status>')
def get_status_details(status):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 
                t.organization,
                t.address,
                t.population,
                t.median_income,
                t.latitude,
                t.longitude,
                z.grade
            FROM targets t
            LEFT JOIN zip_data z ON t.region = z.zip_code
            WHERE COALESCE(t.status, 'not-contacted') = ?
        ''', (status,))
        
        targets = []
        for row in cursor.fetchall():
            targets.append({
                'organization': row[0],
                'address': row[1],
                'population': row[2],
                'median_income': row[3],
                'latitude': row[4],
                'longitude': row[5],
                'grade': row[6]
            })
        
        return jsonify(targets)
    except Exception as e:
        print(f"Error getting status details: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/dbmanager')
def dbmanager():
    return send_from_directory('.', 'dbmanager.html')

@app.route('/api/db/query', methods=['POST'])
def execute_query():
    data = request.get_json()
    query = data.get('query', '').strip().lower()
    
    # Prevent dangerous operations
    dangerous_keywords = ['drop', 'truncate', 'delete', 'update', 'insert', 'alter', 'create']
    if any(keyword in query for keyword in dangerous_keywords):
        return jsonify({'error': 'This type of query is not allowed in the web interface'}), 400
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(query)
        
        # If it's a SELECT query, fetch results
        if query.startswith('select'):
            rows = cursor.fetchall()
            # Convert rows to list of dicts
            columns = [description[0] for description in cursor.description]
            results = []
            for row in rows:
                row_dict = {}
                for i, value in enumerate(row):
                    row_dict[columns[i]] = value
                results.append(row_dict)
            return jsonify({'rows': results})
        
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/db/schema')
def get_schema():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        # Get table schemas
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table'")
        schemas = [row[0] for row in cursor.fetchall() if row[0] is not None]
        
        return jsonify(schemas)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/db/backups')
def list_backups():
    backup_dir = 'data/backups'
    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir)
    
    backups = []
    for filename in os.listdir(backup_dir):
        if filename.endswith('.db'):
            timestamp = datetime.fromtimestamp(os.path.getctime(os.path.join(backup_dir, filename)))
            backups.append({
                'filename': filename,
                'timestamp': timestamp.strftime('%Y-%m-%d %H:%M:%S')
            })
    
    return jsonify(sorted(backups, key=lambda x: x['timestamp'], reverse=True))

@app.route('/api/db/backup', methods=['POST'])
def create_backup():
    backup_dir = 'data/backups'
    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = os.path.join(backup_dir, f'targets_{timestamp}.db')
    
    try:
        shutil.copy2('data/targets.db', backup_path)
        return jsonify({'success': True, 'filename': os.path.basename(backup_path)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/backup', methods=['DELETE'])
def delete_backup():
    data = request.get_json()
    filename = data.get('filename')
    
    if not filename or '..' in filename:  # Prevent directory traversal
        return jsonify({'error': 'Invalid filename'}), 400
    
    backup_path = os.path.join('data/backups', filename)
    
    try:
        if os.path.exists(backup_path):
            os.remove(backup_path)
            return jsonify({'success': True})
        return jsonify({'error': 'Backup not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/db/restore', methods=['POST'])
def restore_backup():
    data = request.get_json()
    filename = data.get('filename')
    
    if not filename or '..' in filename:  # Prevent directory traversal
        return jsonify({'error': 'Invalid filename'}), 400
    
    backup_path = os.path.join('data/backups', filename)
    db_path = 'data/targets.db'
    
    try:
        if not os.path.exists(backup_path):
            return jsonify({'error': 'Backup not found'}), 404
        
        # Create a backup of current state before restoring
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        pre_restore_backup = os.path.join('data/backups', f'pre_restore_{timestamp}.db')
        
        # Close any existing connections
        try:
            conn = get_db_connection()
            conn.close()
        except:
            pass  # Ignore if no connection exists
        
        # Make backup of current state
        if os.path.exists(db_path):
            shutil.copy2(db_path, pre_restore_backup)
        
        # Restore the selected backup
        shutil.copy2(backup_path, db_path)
        
        # Verify the restored database
        conn = get_db_connection()
        try:
            # Check if we can read from the database
            count = conn.execute('SELECT COUNT(*) FROM targets').fetchone()[0]
            print(f"Restored database has {count} targets")
            return jsonify({'success': True, 'count': count})
        finally:
            conn.close()
            
    except Exception as e:
        print(f"Error restoring backup: {e}")
        # Try to restore from pre-restore backup if it exists
        if os.path.exists(pre_restore_backup):
            try:
                shutil.copy2(pre_restore_backup, db_path)
                print("Restored from pre-restore backup after error")
            except Exception as e2:
                print(f"Error restoring from pre-restore backup: {e2}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/download_backup/<filename>')
def download_backup(filename):
    backup_dir = 'data/backups'
    try:
        return send_from_directory(backup_dir, filename, as_attachment=True)
    except Exception as e:
        print(f"Error downloading backup: {e}")
        return str(e), 500

@app.route('/api/upload_backup', methods=['POST'])
def upload_backup():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if not file.filename.endswith('.db'):
        return jsonify({'error': 'Invalid file type. Must be a .db file'}), 400

    backup_dir = 'data/backups'
    db_path = 'data/targets.db'
    try:
        if not os.path.exists(backup_dir):
            os.makedirs(backup_dir)
        
        # Save with timestamp to avoid conflicts
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'uploaded_{timestamp}_{file.filename}'
        file_path = os.path.join(backup_dir, filename)
        
        # First save the uploaded file
        file.save(file_path)
        
        # Create a backup of current state before restoring
        pre_restore_backup = os.path.join(backup_dir, f'pre_restore_{timestamp}.db')
        
        # Close any existing connections
        try:
            conn = get_db_connection()
            conn.close()
        except:
            pass  # Ignore if no connection exists
        
        # Make backup of current state
        if os.path.exists(db_path):
            shutil.copy2(db_path, pre_restore_backup)
        
        # Restore the uploaded file
        shutil.copy2(file_path, db_path)
        
        # Verify the restored database
        conn = get_db_connection()
        try:
            # Check if we can read from the database
            count = conn.execute('SELECT COUNT(*) FROM targets').fetchone()[0]
            print(f"Restored database has {count} targets")
            return jsonify({'success': True, 'filename': filename, 'count': count})
        finally:
            conn.close()
            
    except Exception as e:
        print(f"Error uploading/restoring backup: {e}")
        # Try to restore from pre-restore backup if it exists
        if os.path.exists(pre_restore_backup):
            try:
                shutil.copy2(pre_restore_backup, db_path)
                print("Restored from pre-restore backup after error")
            except Exception as e2:
                print(f"Error restoring from pre-restore backup: {e2}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting test server...")
    print(f"Current directory: {os.getcwd()}")
    print(f"index_db.html exists: {os.path.exists('index_db.html')}")
    print(f"kanban.html exists: {os.path.exists('kanban.html')}")
    print(f"dashboard.html exists: {os.path.exists('dashboard.html')}")
    
    # Test database connection
    try:
        conn = get_db_connection()
        print("Database connection successful")
        print("Tables:", [t[0] for t in conn.execute('SELECT name FROM sqlite_master WHERE type="table"').fetchall()])
        conn.close()
    except Exception as e:
        print(f"Database connection error: {e}")
    
    app.run(debug=True, port=5000)
