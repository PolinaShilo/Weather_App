from fastapi import FastAPI, Request, Form, Depends, HTTPException, status
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from datetime import datetime, timedelta
from typing import Optional
import hashlib
import hmac
import secrets
import base64
import csv
import aiohttp
import os

# Конфигурация
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-here-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Database setup
DATABASE_URL = "sqlite:///./cities.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Модели
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=False)
    salt = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class City(Base):
    __tablename__ = "cities"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    latitude = Column(Float)
    longitude = Column(Float)
    temperature = Column(Float, nullable=True)
    updated_at = Column(DateTime, nullable=True)
    user_id = Column(Integer, nullable=True)

class DefaultCity(Base):
    __tablename__ = "default_cities"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    latitude = Column(Float)
    longitude = Column(Float)

# Create tables
Base.metadata.create_all(bind=engine)

# FastAPI setup
app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Простая система хеширования паролей
def generate_salt() -> str:
    """Генерирует случайную соль"""
    return secrets.token_hex(16)

def hash_password(password: str, salt: str) -> str:
    """Хеширует пароль с использованием соли"""
    # Используем PBKDF2 для безопасного хеширования
    encoded_password = password.encode('utf-8')
    encoded_salt = salt.encode('utf-8')
    
    # 100000 итераций для безопасности
    hashed = hashlib.pbkdf2_hmac(
        'sha256',
        encoded_password,
        encoded_salt,
        100000
    )
    
    # Кодируем в base64 для хранения
    return base64.b64encode(hashed).decode('utf-8')

def verify_password(password: str, salt: str, hashed_password: str) -> bool:
    """Проверяет пароль"""
    new_hash = hash_password(password, salt)
    return hmac.compare_digest(new_hash, hashed_password)

# JWT токены
import jwt

def create_access_token(data: dict) -> str:
    """Создает JWT токен"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_token(token: str) -> Optional[dict]:
    """Декодирует JWT токен"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None

# Utility functions
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def fetch_weather(latitude: float, longitude: float):
    async with aiohttp.ClientSession() as session:
        url = f"https://api.open-meteo.com/v1/forecast"
        async with session.get(url) as response:
            data = await response.json()
            return data["current_weather"]["temperature"]

# Helper функции для пользователей
def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()

def authenticate_user(db: Session, email: str, password: str):
    user = get_user_by_email(db, email)
    if not user:
        return None
    
    if not verify_password(password, user.salt, user.hashed_password):
        return None
    
    return user

def get_current_user_from_token(token: str, db: Session):
    payload = decode_token(token)
    if not payload:
        return None
    
    email = payload.get("sub")
    if not email:
        return None
    
    return get_user_by_email(db, email)

# Middleware для проверки авторизации
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Пропускаем статические файлы и страницы аутентификации
    if request.url.path.startswith("/static") or \
       request.url.path in ["/login", "/register", "/"]:
        return await call_next(request)
    
    # Проверяем токен в cookies
    token = request.cookies.get("access_token")
    if token:
        db = next(get_db())
        user = get_current_user_from_token(token, db)
        if user:
            request.state.user = user
        else:
            # Невалидный токен - удаляем cookie
            response = RedirectResponse("/login", status_code=303)
            response.delete_cookie("access_token")
            return response
    else:
        # Нет токена - редирект на логин
        return RedirectResponse("/login", status_code=303)
    
    return await call_next(request)

# Роуты аутентификации
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
    # Проверяем, существует ли пользователь
    existing_user = get_user_by_email(db, email)
    if existing_user:
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": "Email already registered"}
        )
    
    # Проверяем длину пароля
    if len(password) < 6:
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": "Password must be at least 6 characters"}
        )
    
    # Создаем нового пользователя
    salt = generate_salt()
    hashed_password = hash_password(password, salt)
    
    db_user = User(
        email=email,
        username=username,
        hashed_password=hashed_password,
        salt=salt
    )
    
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    # Создаем токен
    access_token = create_access_token({"sub": db_user.email})
    
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(key="access_token", value=access_token, httponly=True, max_age=1800)
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
    user = authenticate_user(db, email, password)
    if not user:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid email or password"}
        )
    
    access_token = create_access_token({"sub": user.email})
    
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(key="access_token", value=access_token, httponly=True, max_age=1800)
    return response

@app.post("/logout")
async def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(key="access_token")
    return response

# Обновленные роуты
@app.get("/")
async def read_root(
    request: Request,
    db: Session = Depends(get_db)
):
    # Проверяем авторизацию через cookies
    token = request.cookies.get("access_token")
    current_user = None
    
    if token:
        current_user = get_current_user_from_token(token, db)
    
    if current_user:
        # Показываем города пользователя
        cities = db.query(City).filter(
            (City.user_id == current_user.id) | (City.user_id.is_(None))
        ).all()
        return templates.TemplateResponse(
            "index.html",
            {"request": request, "cities": cities, "user": current_user}
        )
    else:
        # Показываем только общие города
        cities = db.query(City).filter(City.user_id.is_(None)).all()
        return templates.TemplateResponse(
            "index.html",
            {"request": request, "cities": cities, "user": None}
        )

@app.post("/cities/add")
async def add_city(
    request: Request,
    name: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    db: Session = Depends(get_db)
):
    # Проверяем авторизацию
    token = request.cookies.get("access_token")
    if not token:
        return RedirectResponse("/login", status_code=303)
    
    current_user = get_current_user_from_token(token, db)
    if not current_user:
        return RedirectResponse("/login", status_code=303)
    
    city = City(
        name=name,
        latitude=latitude,
        longitude=longitude,
        user_id=current_user.id
    )
    db.add(city)
    db.commit()
    return RedirectResponse("/", status_code=303)

@app.post("/cities/remove/{city_id}")
async def remove_city(
    request: Request,
    city_id: int,
    db: Session = Depends(get_db)
):
    # Проверяем авторизацию
    token = request.cookies.get("access_token")
    if not token:
        return RedirectResponse("/login", status_code=303)
    
    current_user = get_current_user_from_token(token, db)
    if not current_user:
        return RedirectResponse("/login", status_code=303)
    
    city = db.query(City).filter(
        City.id == city_id,
        City.user_id == current_user.id
    ).first()
    
    if city:
        db.delete(city)
        db.commit()
    
    return RedirectResponse("/", status_code=303)

@app.post("/cities/reset")
async def reset_cities(
    request: Request,
    db: Session = Depends(get_db)
):
    # Проверяем авторизацию
    token = request.cookies.get("access_token")
    if not token:
        return RedirectResponse("/login", status_code=303)
    
    current_user = get_current_user_from_token(token, db)
    if not current_user:
        return RedirectResponse("/login", status_code=303)
    
    # Удаляем только города пользователя
    db.query(City).filter(City.user_id == current_user.id).delete()
    
    # Добавляем города по умолчанию для пользователя
    default_cities = db.query(DefaultCity).all()
    for default in default_cities:
        city = City(
            name=default.name,
            latitude=default.latitude,
            longitude=default.longitude,
            user_id=current_user.id
        )
        db.add(city)
    
    db.commit()
    return RedirectResponse("/", status_code=303)

@app.post("/cities/update")
async def update_weather(
    request: Request,
    db: Session = Depends(get_db)
):
    # Проверяем авторизацию
    token = request.cookies.get("access_token")
    if not token:
        return RedirectResponse("/login", status_code=303)
    
    current_user = get_current_user_from_token(token, db)
    if not current_user:
        return RedirectResponse("/login", status_code=303)
    
    cities = db.query(City).filter(City.user_id == current_user.id).all()
    for city in cities:
        city.temperature = await fetch_weather(city.latitude, city.longitude)
        city.updated_at = datetime.utcnow()
    
    db.commit()
    return RedirectResponse("/", status_code=303)

@app.on_event("startup")
def populate_default_cities():
    db = SessionLocal()
    
    try:
        # Создаем администратора по умолчанию (без bcrypt)
        if not db.query(User).filter(User.email == "admin@example.com").first():
            salt = generate_salt()
            hashed_password = hash_password("admin123", salt)
            
            admin_user = User(
                email="admin@example.com",
                username="admin",
                hashed_password=hashed_password,
                salt=salt,
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            print("Admin user created: admin@example.com / admin123")
        
        # Добавляем города по умолчанию
        if not db.query(DefaultCity).first():
            try:
                with open("europe.csv", "r") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        default_city = DefaultCity(
                            name=row["name"],
                            latitude=float(row["latitude"]),
                            longitude=float(row["longitude"])
                        )
                        db.add(default_city)
                db.commit()
                print("Default cities added from europe.csv")
            except FileNotFoundError:
                print("Warning: europe.csv not found. Creating sample cities...")
                # Создаем несколько городов по умолчанию
                sample_cities = [
                    ("London", 51.5074, -0.1278),
                    ("Paris", 48.8566, 2.3522),
                    ("Berlin", 52.5200, 13.4050),
                    ("Rome", 41.9028, 12.4964),
                    ("Madrid", 40.4168, -3.7038),
                ]
                
                for name, lat, lon in sample_cities:
                    default_city = DefaultCity(
                        name=name,
                        latitude=lat,
                        longitude=lon
                    )
                    db.add(default_city)
                
                db.commit()
                print("Sample cities created")
    
    except Exception as e:
        print(f"Error during startup: {e}")
        db.rollback()
    
    finally:
        db.close()

# Добавим API endpoint для проверки здоровья
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}