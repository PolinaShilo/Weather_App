# migrate_db.py
import sqlite3
import sys


def migrate_database():
    """Добавляет недостающие колонки в существующую базу данных"""

    db_path = "cities.db"

    try:
        # Подключаемся к базе данных
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        print("Connected to database...")

        # 1. Проверяем таблицу users и добавляем колонку salt если её нет
        cursor.execute("PRAGMA table_info(users)")
        users_columns = [column[1] for column in cursor.fetchall()]

        if 'salt' not in users_columns:
            print("Adding 'salt' column to users table...")
            cursor.execute("ALTER TABLE users ADD COLUMN salt TEXT DEFAULT ''")
            print("✓ Column 'salt' added to users table")
        else:
            print("✓ Column 'salt' already exists in users table")

        # 2. Проверяем таблицу cities и добавляем колонку user_id если её нет
        cursor.execute("PRAGMA table_info(cities)")
        cities_columns = [column[1] for column in cursor.fetchall()]

        if 'user_id' not in cities_columns:
            print("Adding 'user_id' column to cities table...")
            cursor.execute("ALTER TABLE cities ADD COLUMN user_id INTEGER")
            print("✓ Column 'user_id' added to cities table")
        else:
            print("✓ Column 'user_id' already exists in cities table")

        # 3. Обновляем старых пользователей - добавляем им соль
        print("\nUpdating existing users...")
        cursor.execute("SELECT id, password_hash FROM users WHERE salt = '' OR salt IS NULL")
        users = cursor.fetchall()

        for user_id, password_hash in users:
            # Для существующих пользователей используем пустую соль
            # Это позволит сохранить совместимость с их паролями
            cursor.execute(
                "UPDATE users SET salt = ? WHERE id = ?",
                ("", user_id)
            )
            print(f"  Updated user {user_id}")

        # 4. Если есть старая колонка hashed_password, переименовываем её
        cursor.execute("PRAGMA table_info(users)")
        users_columns = [column[1] for column in cursor.fetchall()]

        if 'hashed_password' not in users_columns and 'password_hash' in users_columns:
            print("\nRenaming password_hash to hashed_password...")
            # SQLite не поддерживает RENAME COLUMN напрямую, нужно создать новую таблицу
            # Вместо этого просто создадим новую колонку и скопируем данные
            cursor.execute("ALTER TABLE users ADD COLUMN hashed_password TEXT")
            cursor.execute("UPDATE users SET hashed_password = password_hash WHERE hashed_password IS NULL")
            print("✓ Column renamed")

        # 5. Проверяем таблицу default_cities
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='default_cities'")
        if not cursor.fetchone():
            print("\nCreating default_cities table...")
            cursor.execute("""
                CREATE TABLE default_cities (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE,
                    latitude REAL,
                    longitude REAL
                )
            """)
            print("✓ default_cities table created")

            # Добавляем несколько городов по умолчанию
            sample_cities = [
                ("London", 51.5074, -0.1278),
                ("Paris", 48.8566, 2.3522),
                ("Berlin", 52.5200, 13.4050),
                ("Rome", 41.9028, 12.4964),
                ("Madrid", 40.4168, -3.7038),
            ]

            for name, lat, lon in sample_cities:
                cursor.execute(
                    "INSERT OR IGNORE INTO default_cities (name, latitude, longitude) VALUES (?, ?, ?)",
                    (name, lat, lon)
                )
            print("✓ Sample cities added")

        # Сохраняем изменения
        conn.commit()
        print("\n✓ Migration completed successfully!")

        # Показываем итоговую структуру
        print("\nFinal database structure:")
        print("-" * 50)

        tables = ['users', 'cities', 'default_cities']
        for table in tables:
            cursor.execute(f"PRAGMA table_info({table})")
            columns = cursor.fetchall()
            if columns:
                print(f"\n{table.upper()}:")
                for col in columns:
                    print(f"  {col[1]} ({col[2]})")

    except sqlite3.Error as e:
        print(f"✗ Database error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ Error: {e}")
        sys.exit(1)
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    print("Starting database migration...")
    print("=" * 50)
    migrate_database()