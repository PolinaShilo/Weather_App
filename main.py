from fastapi import FastAPI, Request, Form, Depends, HTTPException
from fastapi.responses import RedirectResponse, HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, text, desc
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select
from datetime import datetime, timedelta
from typing import Optional, List, Dict
import hashlib
import hmac
import secrets
import base64
import csv
import aiohttp
import asyncio
import os
import json
import time  # ← ДОБАВЬТЕ ЭТО

# СОЗДАЕМ ЭКЗЕМПЛЯР FASTAPI ТОЛЬКО ОДИН РАЗ
app = FastAPI()

# Создаем Base
Base = declarative_base()

# Настраиваем БД
DATABASE_URL = "sqlite:///./cities.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Асинхронная версия для новых endpoint'ов
ASYNC_DATABASE_URL = "sqlite+aiosqlite:///./cities.db"
async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=True)
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)


# Функция для получения синхронной сессии
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Функция для получения асинхронной сессии
async def get_async_db():
    async with AsyncSessionLocal() as session:
        yield session


# Инициализация шаблонов и статических файлов
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Конфигурация
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
UPDATE_INTERVAL_MINUTES = 15


# ========== МОДЕЛИ БАЗЫ ДАННЫХ ==========
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=False, default="")
    salt = Column(String, nullable=False, default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class City(Base):
    __tablename__ = "cities"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    latitude = Column(Float)
    longitude = Column(Float)
    temperature = Column(Float, nullable=True)
    updated_at = Column(DateTime, nullable=True)
    user_id = Column(Integer, nullable=True, default=None)


class DefaultCity(Base):
    __tablename__ = "default_cities"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    latitude = Column(Float)
    longitude = Column(Float)


# ========== ФУНКЦИИ ДЛЯ РАБОТЫ С ТОКЕНАМИ ==========
def create_access_token(data: dict) -> str:
    """Создает простой токен в формате base64"""
    print(f"DEBUG: Creating token with data: {data}")

    # Создаем копию данных
    data_copy = data.copy()

    # Добавляем время истечения
    expire = time.time() + (ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    data_copy["exp"] = expire

    # Конвертируем datetime в строки
    for key, value in data_copy.items():
        if isinstance(value, datetime):
            data_copy[key] = value.isoformat()

    # Кодируем в JSON и затем в base64
    token_json = json.dumps(data_copy)
    token = base64.b64encode(token_json.encode()).decode()

    print(f"DEBUG: Token created (first 50 chars): {token[:50]}...")
    return token


def decode_token(token: str) -> Optional[dict]:
    """Декодирует токен из base64"""
    print(f"DEBUG: Decoding token (first 50 chars): {token[:50]}...")

    if not token:
        print("DEBUG: No token provided")
        return None

    try:
        # Декодируем из base64
        token_json = base64.b64decode(token).decode()
        data = json.loads(token_json)

        # Проверяем expiration
        if "exp" in data and data["exp"] < time.time():
            print(f"DEBUG: Token expired at {data['exp']}, current time {time.time()}")
            return None

        print(f"DEBUG: Token decoded successfully: {data}")
        return data

    except Exception as e:
        print(f"DEBUG: Error decoding token: {e}")
        return None


# ========== ФУНКЦИИ ДЛЯ РАБОТЫ С ПАРОЛЯМИ ==========
def generate_salt() -> str:
    return secrets.token_hex(16)


def hash_password(password: str, salt: str = "") -> str:
    """Хеширование пароля"""
    if not salt:
        # Старый метод: простой SHA256
        return hashlib.sha256(password.encode()).hexdigest()

    # Новый метод: PBKDF2
    return base64.b64encode(hashlib.pbkdf2_hmac(
        'sha256',
        password.encode(),
        salt.encode(),
        100000
    )).decode()


def verify_password(password: str, salt: str, stored_hash: str) -> bool:
    """Проверка пароля"""
    if not stored_hash:
        return False

    print(f"DEBUG verify_password: salt='{salt}', stored_hash='{stored_hash[:20]}...'")

    if not salt:
        # Старый метод
        computed_hash = hashlib.sha256(password.encode()).hexdigest()
        result = hmac.compare_digest(computed_hash, stored_hash)
        print(f"DEBUG: Old method, result={result}")
        return result

    # Новый метод
    computed_hash = hash_password(password, salt)
    result = hmac.compare_digest(computed_hash, stored_hash)
    print(f"DEBUG: New method, result={result}")
    return result


# ========== ФУНКЦИИ ДЛЯ РАБОТЫ С API ==========
async def fetch_weather_for_coordinates(latitude: float, longitude: float) -> float:
    """Получает температуру для координат через Open-Meteo API"""
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather=true"
        timeout = aiohttp.ClientTimeout(total=10, connect=5)

        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    if "current_weather" in data and "temperature" in data["current_weather"]:
                        temperature = data["current_weather"]["temperature"]
                        print(f"✓ Получена температура {temperature}°C для ({latitude}, {longitude})")
                        return temperature
                    else:
                        raise Exception("Invalid API response structure")
                else:
                    raise Exception(f"API returned status {response.status}")
    except Exception as e:
        print(f"Error fetching weather for ({latitude}, {longitude}): {e}")
        raise


# ========== API ENDPOINTS ==========
@app.post("/api/weather/{city_id}")
async def update_city_weather_api(city_id: int, db: Session = Depends(get_db)):
    """Обновить погоду для конкретного города"""
    print(f"\n{'=' * 50}")
    print(f"API UPDATE for city_id: {city_id}")

    city = db.query(City).filter(City.id == city_id).first()

    if not city:
        print(f"City {city_id} not found")
        raise HTTPException(status_code=404, detail="City not found")

    print(f"City: {city.name}, Current temp: {city.temperature}, Last updated: {city.updated_at}")

    try:
        # Получаем температуру
        temperature = await fetch_weather_for_coordinates(city.latitude, city.longitude)

        # Обновляем в базе
        city.temperature = temperature
        city.updated_at = datetime.utcnow()  # ОБНОВЛЯЕМ ВРЕМЯ
        db.commit()

        print(f"Updated: temp={temperature}, new_time={city.updated_at}")

        # Возвращаем данные с ISO форматом времени
        return {
            "success": True,
            "city_id": city.id,
            "city_name": city.name,
            "temperature": temperature,
            "updated_at": city.updated_at.isoformat()  # ВАЖНО: ISO формат
        }

    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
        return {
            "success": False,
            "error": str(e)
        }
@app.get("/api/weather/{city_id}")
async def get_city_weather_api(city_id: int, db: Session = Depends(get_db)):
    """Получить текущую погоду для города (GET)"""
    city = db.query(City).filter(City.id == city_id).first()

    if not city:
        raise HTTPException(status_code=404, detail="City not found")

    return {
        "city_id": city.id,
        "city_name": city.name,
        "temperature": city.temperature,
        "latitude": city.latitude,
        "longitude": city.longitude,
        "updated_at": city.updated_at.isoformat() if city.updated_at else None
    }


@app.get("/api/test-weather")
async def test_weather_api(latitude: float, longitude: float):
    """Тестовый эндпоинт для проверки API"""
    try:
        temperature = await fetch_weather_for_coordinates(latitude, longitude)
        return {
            "success": True,
            "latitude": latitude,
            "longitude": longitude,
            "temperature": temperature,
            "unit": "°C"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
def can_update_city(city: City) -> bool:
    if not city.updated_at:
        return True
    minutes_since_update = (datetime.utcnow() - city.updated_at).total_seconds() / 60
    return minutes_since_update >= UPDATE_INTERVAL_MINUTES


def get_cities_sorted_by_temperature(db: Session, user_id: Optional[int] = None):
    query = db.query(City)
    if user_id is not None:
        query = query.filter(City.user_id == user_id)
    else:
        query = query.filter(City.user_id.is_(None))
    return query.order_by(desc(City.temperature.isnot(None)), desc(City.temperature)).all()


def get_current_user(request: Request, db: Session = Depends(get_db)):
    """Получает текущего пользователя из токена"""
    token = request.cookies.get("access_token")
    print(f"\n{'=' * 50}")
    print(f"DEBUG get_current_user: token={'Exists' if token else 'None'}")

    if not token:
        print("DEBUG: No token found in cookies")
        return None

    payload = decode_token(token)
    if not payload:
        print("DEBUG: Failed to decode token")
        return None

    email = payload.get("sub")
    if not email:
        print("DEBUG: No email in token payload")
        return None

    print(f"DEBUG: Looking for user with email: {email}")
    user = db.query(User).filter(User.email == email).first()

    if user:
        print(f"DEBUG: User found: {user.username} (id: {user.id})")
    else:
        print(f"DEBUG: User not found for email: {email}")

    return user


# ========== ВЕБ-СТРАНИЦЫ ==========
@app.get("/")
async def read_root(request: Request, db: Session = Depends(get_db)):
    """Главная страница"""
    print(f"\n{'=' * 50}")
    print("HOME PAGE REQUEST")

    # Получаем текущего пользователя
    current_user = get_current_user(request, db)

    if current_user:
        cities = get_cities_sorted_by_temperature(db, current_user.id)
        print(f"Got {len(cities)} cities for user {current_user.id}")
    else:
        cities = get_cities_sorted_by_temperature(db, None)
        print(f"Got {len(cities)} public cities")

    print(f"User object: {current_user}")
    print(f"{'=' * 50}\n")

    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "cities": cities,
            "user": current_user,
            "update_interval": UPDATE_INTERVAL_MINUTES,
            "now": datetime.utcnow()
        }
    )


@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    return templates.TemplateResponse("register.html", {"request": request})


@app.post("/register")
async def register(
        request: Request,
        email: str = Form(...),
        username: str = Form(...),
        password: str = Form(...),
        db: Session = Depends(get_db)
):
    print(f"\n{'=' * 50}")
    print("REGISTRATION REQUEST")
    print(f"Email: {email}")
    print(f"Username: {username}")

    # Проверяем существование пользователя
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        print("ERROR: User already exists")
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": "Email уже зарегистрирован"}
        )

    # Создаем соль и хешируем пароль
    salt = generate_salt()
    hashed_password = hash_password(password, salt)

    print(f"Salt: {salt}")
    print(f"Hashed password (first 20): {hashed_password[:20]}...")

    # Создаем пользователя
    db_user = User(
        email=email,
        username=username,
        hashed_password=hashed_password,
        salt=salt,
        is_active=True
    )

    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    print(f"User created: id={db_user.id}")

    # Создаем токен
    token_data = {
        "sub": email,
        "user_id": db_user.id,
        "username": username,
        "created_at": datetime.utcnow().isoformat()
    }

    access_token = create_access_token(token_data)

    # Создаем ответ с куками
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=1800,  # 30 минут
        path="/",
        samesite="lax"
    )

    # Дополнительные куки для отладки
    response.set_cookie(
        key="user_id",
        value=str(db_user.id),
        max_age=1800,
        path="/"
    )

    response.set_cookie(
        key="username",
        value=username,
        max_age=1800,
        path="/"
    )

    print("Registration successful!")
    print(f"{'=' * 50}\n")

    return response


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@app.post("/login")
async def login(
        request: Request,
        email: str = Form(...),
        password: str = Form(...),
        db: Session = Depends(get_db)
):
    print(f"\n{'=' * 50}")
    print("LOGIN REQUEST")
    print(f"Email: {email}")

    # Ищем пользователя
    user = db.query(User).filter(User.email == email).first()

    if not user:
        print("ERROR: User not found")
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Пользователь не найден"}
        )

    print(f"User found: {user.username} (id: {user.id})")
    print(f"User salt: {user.salt}")
    print(f"Stored hash (first 20): {user.hashed_password[:20]}...")

    # Проверяем пароль
    is_valid = verify_password(password, user.salt, user.hashed_password)
    print(f"Password valid: {is_valid}")

    if not is_valid:
        # Пробуем старый метод для совместимости
        if not user.salt:
            old_hash = hashlib.sha256(password.encode()).hexdigest()
            print(f"Trying old hash method: {old_hash}")
            if old_hash == user.hashed_password:
                print("SUCCESS: Old hash method worked!")
                is_valid = True
                # Обновляем на новый метод
                user.salt = generate_salt()
                user.hashed_password = hash_password(password, user.salt)
                db.commit()
                print("User password updated to new method")
            else:
                print("ERROR: Old hash also failed")

    if not is_valid:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Неверный пароль"}
        )

    # Создаем токен
    token_data = {
        "sub": user.email,
        "user_id": user.id,
        "username": user.username,
        "created_at": datetime.utcnow().isoformat()
    }

    access_token = create_access_token(token_data)
    print(f"Token created (first 50): {access_token[:50]}...")

    # Создаем ответ с куками
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=1800,
        path="/",
        samesite="lax"
    )

    # Дополнительные куки для отладки
    response.set_cookie(
        key="user_id",
        value=str(user.id),
        max_age=1800,
        path="/"
    )

    response.set_cookie(
        key="username",
        value=user.username,
        max_age=1800,
        path="/"
    )

    print("Login successful!")
    print(f"{'=' * 50}\n")

    return response


@app.post("/logout")
async def logout():
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(key="access_token")
    response.delete_cookie(key="user_id")
    response.delete_cookie(key="username")
    return response


@app.post("/cities/update")
async def update_weather(request: Request, db: Session = Depends(get_db)):
    """Обновить погоду для всех городов пользователя"""
    print(f"\n{'=' * 50}")
    print("UPDATE ALL CITIES REQUEST")

    # Проверяем авторизацию
    current_user = get_current_user(request, db)
    if not current_user:
        print("ERROR: Not authenticated")
        return RedirectResponse("/login", status_code=303)

    print(f"Updating weather for user: {current_user.username}")

    try:
        user_cities = db.query(City).filter(City.user_id == current_user.id).all()
        cities_to_update = [city for city in user_cities if can_update_city(city)]

        if not cities_to_update:
            print("No cities need update")
            # Возвращаем JSON для AJAX
            if request.headers.get("accept") == "application/json":
                return JSONResponse(
                    content={"success": True, "message": "No cities need update", "updated": 0}
                )
            return RedirectResponse("/?info=No+cities+need+update", status_code=303)

        print(f"Updating {len(cities_to_update)} cities...")

        updated_count = 0
        for city in cities_to_update:
            try:
                temperature = await fetch_weather_for_coordinates(city.latitude, city.longitude)
                city.temperature = temperature
                city.updated_at = datetime.utcnow()
                updated_count += 1
                print(f"✓ Updated {city.name}: {temperature}°C")
            except Exception as e:
                print(f"✗ Failed to update {city.name}: {e}")

        db.commit()
        print(f"Updated {updated_count} cities successfully")

        # Возвращаем JSON для AJAX или редирект для обычного запроса
        if request.headers.get("accept") == "application/json":
            return JSONResponse(
                content={
                    "success": True,
                    "message": f"Updated {updated_count} cities",
                    "updated": updated_count
                }
            )

        return RedirectResponse(f"/?success=Updated+{updated_count}+cities", status_code=303)

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")

        if request.headers.get("accept") == "application/json":
            return JSONResponse(
                content={"success": False, "error": str(e)},
                status_code=500
            )

        return RedirectResponse("/?error=Failed+to+update+weather", status_code=303)


@app.post("/cities/add")
async def add_city(
        request: Request,
        name: str = Form(...),
        latitude: float = Form(...),
        longitude: float = Form(...),
        db: Session = Depends(get_db)
):
    print(f"\n{'=' * 50}")
    print("ADD CITY REQUEST")
    print(f"City: {name} ({latitude}, {longitude})")

    # Проверяем авторизацию
    current_user = get_current_user(request, db)
    if not current_user:
        print("ERROR: Not authenticated")
        return RedirectResponse("/login", status_code=303)

    print(f"Adding city for user: {current_user.username}")

    # Проверяем, нет ли уже такого города у пользователя
    existing_city = db.query(City).filter(
        City.name == name,
        City.user_id == current_user.id
    ).first()

    if existing_city:
        print("ERROR: City already exists")
        return RedirectResponse("/?error=City+already+exists", status_code=303)

    # Создаем город
    city = City(
        name=name,
        latitude=latitude,
        longitude=longitude,
        user_id=current_user.id
    )

    db.add(city)
    db.commit()

    print(f"City added successfully: {name}")

    return RedirectResponse("/", status_code=303)


@app.post("/cities/remove/{city_id}")
async def remove_city(
        request: Request,
        city_id: int,
        db: Session = Depends(get_db)
):
    print(f"\n{'=' * 50}")
    print(f"REMOVE CITY REQUEST for id: {city_id}")

    # Проверяем авторизацию
    current_user = get_current_user(request, db)
    if not current_user:
        print("ERROR: Not authenticated")
        return RedirectResponse("/login", status_code=303)

    city = db.query(City).filter(
        City.id == city_id,
        City.user_id == current_user.id
    ).first()

    if city:
        db.delete(city)
        db.commit()
        print(f"City removed: {city.name}")
    else:
        print(f"City not found or not authorized")

    return RedirectResponse("/", status_code=303)


# ========== ИНИЦИАЛИЗАЦИЯ ==========
@app.on_event("startup")
async def on_startup():
    """Создаем таблицы при запуске"""
    print("=" * 50)
    print("Starting Weather App...")
    print("=" * 50)

    Base.metadata.create_all(bind=engine)
    print("✓ Database tables created")

    # Создаем тестового пользователя если его нет
    db = SessionLocal()
    try:
        test_email = "test@test.com"
        test_user = db.query(User).filter(User.email == test_email).first()

        if not test_user:
            salt = generate_salt()
            hashed_password = hash_password("test123", salt)
            user = User(
                email=test_email,
                username="testuser",
                hashed_password=hashed_password,
                salt=salt,
                is_active=True
            )
            db.add(user)
            db.commit()
            print(f"✓ Test user created ({test_email} / test123)")
        else:
            print("✓ Test user already exists")

        # Создаем тестовые города если их нет
        if db.query(City).count() == 0:
            test_cities = [
                ("Moscow", 55.7558, 37.6173),
                ("London", 51.5074, -0.1278),
                ("Paris", 48.8566, 2.3522),
                ("Berlin", 52.5200, 13.4050),
                ("Tokyo", 35.6762, 139.6503),
            ]

            for name, lat, lon in test_cities:
                city = City(
                    name=name,
                    latitude=lat,
                    longitude=lon,
                    user_id=None  # Общие города
                )
                db.add(city)

            db.commit()
            print("✓ Test cities created")

    except Exception as e:
        print(f"✗ Error during startup: {e}")
    finally:
        db.close()

    print("=" * 50)
    print("✓ Application started successfully!")
    print("=" * 50)


@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/debug/auth")
async def debug_auth(request: Request, db: Session = Depends(get_db)):
    """Страница для отладки авторизации"""
    token = request.cookies.get("access_token")
    user = get_current_user(request, db)

    all_users = db.query(User).all()

    return templates.TemplateResponse(
        "debug_auth.html",
        {
            "request": request,
            "token": token,
            "user": user,
            "all_users": all_users
        }
    )


# ========== ЗАПУСК ПРИЛОЖЕНИЯ ==========
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)