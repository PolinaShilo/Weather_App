// Модуль для работы с погодными данными

class WeatherAPI {
    constructor() {
        this.baseUrl = 'https://api.open-meteo.com/v1';
        this.cache = new Map();
        this.cacheDuration = 5 * 60 * 1000; // 5 минут
    }

    async getWeather(latitude, longitude) {
        const cacheKey = `${latitude},${longitude}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
            console.log('Using cached weather data');
            return cached.data;
        }

        try {
            const response = await fetch(
                `${this.baseUrl}/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=temperature_2m,precipitation&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`
            );

            if (!response.ok) {
                throw new Error(`Weather API error: ${response.status}`);
            }

            const data = await response.json();

            // Кэшируем данные
            this.cache.set(cacheKey, {
                timestamp: Date.now(),
                data: data
            });

            return data;
        } catch (error) {
            console.error('Error fetching weather:', error);
            throw error;
        }
    }

    async getCityCoordinates(cityName) {
        try {
            const response = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`
            );

            if (!response.ok) {
                throw new Error(`Geocoding API error: ${response.status}`);
            }

            const data = await response.json();

            if (!data.results || data.results.length === 0) {
                throw new Error('City not found');
            }

            return {
                name: data.results[0].name,
                latitude: data.results[0].latitude,
                longitude: data.results[0].longitude,
                country: data.results[0].country
            };
        } catch (error) {
            console.error('Error fetching coordinates:', error);
            throw error;
        }
    }

    async getWeatherForCities(cities) {
        const promises = cities.map(async (city) => {
            try {
                const weather = await this.getWeather(city.latitude, city.longitude);
                return {
                    ...city,
                    weather: {
                        temperature: weather.current_weather.temperature,
                        windspeed: weather.current_weather.windspeed,
                        weathercode: weather.current_weather.weathercode,
                        time: weather.current_weather.time
                    },
                    forecast: {
                        hourly: weather.hourly,
                        daily: weather.daily
                    }
                };
            } catch (error) {
                console.error(`Error getting weather for ${city.name}:`, error);
                return {
                    ...city,
                    weather: null,
                    error: error.message
                };
            }
        });

        return await Promise.all(promises);
    }

    getWeatherIcon(weatherCode) {
        // Преобразование кодов погоды в иконки
        const codes = {
            0: 'sun', // Clear sky
            1: 'cloud-sun', // Mainly clear
            2: 'cloud', // Partly cloudy
            3: 'cloud', // Overcast
            45: 'smog', // Fog
            48: 'smog', // Depositing rime fog
            51: 'cloud-rain', // Light drizzle
            53: 'cloud-rain', // Moderate drizzle
            55: 'cloud-rain', // Dense drizzle
            61: 'cloud-rain', // Slight rain
            63: 'cloud-rain', // Moderate rain
            65: 'cloud-showers-heavy', // Heavy rain
            71: 'snowflake', // Slight snow
            73: 'snowflake', // Moderate snow
            75: 'snowflake', // Heavy snow
            77: 'snowflake', // Snow grains
            80: 'cloud-showers-heavy', // Slight rain showers
            81: 'cloud-showers-heavy', // Moderate rain showers
            82: 'cloud-showers-heavy', // Violent rain showers
            85: 'snowflake', // Slight snow showers
            86: 'snowflake', // Heavy snow showers
            95: 'bolt', // Thunderstorm
            96: 'bolt', // Thunderstorm with hail
            99: 'bolt' // Heavy thunderstorm with hail
        };

        return codes[weatherCode] || 'question';
    }

    getWeatherDescription(weatherCode) {
        const descriptions = {
            0: 'Clear sky',
            1: 'Mainly clear',
            2: 'Partly cloudy',
            3: 'Overcast',
            45: 'Fog',
            48: 'Rime fog',
            51: 'Light drizzle',
            53: 'Moderate drizzle',
            55: 'Dense drizzle',
            61: 'Slight rain',
            63: 'Moderate rain',
            65: 'Heavy rain',
            71: 'Slight snow',
            73: 'Moderate snow',
            75: 'Heavy snow',
            77: 'Snow grains',
            80: 'Slight rain showers',
            81: 'Moderate rain showers',
            82: 'Violent rain showers',
            85: 'Slight snow showers',
            86: 'Heavy snow showers',
            95: 'Thunderstorm',
            96: 'Thunderstorm with hail',
            99: 'Heavy thunderstorm with hail'
        };

        return descriptions[weatherCode] || 'Unknown';
    }
}

// UI компоненты для отображения погоды
class WeatherUI {
    constructor() {
        this.weatherAPI = new WeatherAPI();
    }

    async updateAllCities() {
        const cityElements = document.querySelectorAll('[data-city-id]');
        const cities = Array.from(cityElements).map(el => ({
            id: el.dataset.cityId,
            name: el.dataset.cityName,
            latitude: parseFloat(el.dataset.cityLat),
            longitude: parseFloat(el.dataset.cityLng)
        }));

        const weatherData = await this.weatherAPI.getWeatherForCities(cities);

        weatherData.forEach(data => {
            this.updateCityElement(data);
        });

        return weatherData;
    }

    updateCityElement(cityData) {
        const element = document.querySelector(`[data-city-id="${cityData.id}"]`);
        if (!element) return;

        if (cityData.error) {
            element.querySelector('.temperature').textContent = 'Error';
            element.querySelector('.temperature').classList.add('temp-error');
            return;
        }

        const tempElement = element.querySelector('.temperature');
        const iconElement = element.querySelector('.weather-icon');
        const descElement = element.querySelector('.weather-description');
        const updatedElement = element.querySelector('.weather-updated');

        if (tempElement) {
            const temp = cityData.weather.temperature;
            tempElement.textContent = `${temp}°C`;
            tempElement.className = 'temperature';

            if (temp > 25) tempElement.classList.add('temp-hot');
            else if (temp < 10) tempElement.classList.add('temp-cold');
            else tempElement.classList.add('temp-mild');
        }

        if (iconElement) {
            const iconClass = this.weatherAPI.getWeatherIcon(cityData.weather.weathercode);
            iconElement.className = `fas fa-${iconClass} weather-icon`;

            // Добавляем цвет в зависимости от типа погоды
            if (iconClass.includes('sun')) iconElement.style.color = '#f39c12';
            else if (iconClass.includes('cloud')) iconElement.style.color = '#95a5a6';
            else if (iconClass.includes('rain') || iconClass.includes('showers')) iconElement.style.color = '#3498db';
            else if (iconClass.includes('snow')) iconElement.style.color = '#ecf0f1';
            else if (iconClass.includes('bolt')) iconElement.style.color = '#f1c40f';
        }

        if (descElement) {
            descElement.textContent = this.weatherAPI.getWeatherDescription(cityData.weather.weathercode);
        }

        if (updatedElement) {
            updatedElement.textContent = new Date().toLocaleTimeString();
        }
    }

    createWeatherCard(cityData) {
        const card = document.createElement('div');
        card.className = 'weather-card';
        card.dataset.cityId = cityData.id;
        card.dataset.cityName = cityData.name;
        card.dataset.cityLat = cityData.latitude;
        card.dataset.cityLng = cityData.longitude;

        const icon = this.weatherAPI.getWeatherIcon(cityData.weather?.weathercode || 0);
        const description = this.weatherAPI.getWeatherDescription(cityData.weather?.weathercode || 0);

        card.innerHTML = `
            <div class="card-header">
                <h3 class="city-name">${cityData.name}</h3>
                <button class="btn btn-outline btn-sm btn-refresh" data-city-id="${cityData.id}">
                    <i class="fas fa-sync-alt"></i>
                </button>
            </div>
            <div class="card-content">
                <div class="weather-main">
                    <i class="fas fa-${icon} weather-icon" style="font-size: 2.5rem;"></i>
                    <div class="weather-temp">
                        <span class="temperature">${cityData.weather?.temperature || '--'}°C</span>
                        <span class="weather-description">${description}</span>
                    </div>
                </div>
                <div class="weather-details">
                    <div class="detail-item">
                        <i class="fas fa-wind"></i>
                        <span>${cityData.weather?.windspeed || '--'} km/h</span>
                    </div>
                    <div class="detail-item">
                        <i class="fas fa-map-marker-alt"></i>
                        <span>${cityData.latitude.toFixed(2)}, ${cityData.longitude.toFixed(2)}</span>
                    </div>
                </div>
                <div class="weather-updated">
                    Updated: ${cityData.weather?.time ? new Date(cityData.weather.time).toLocaleTimeString() : 'Never'}
                </div>
            </div>
        `;

        // Добавляем обработчик для кнопки обновления
        card.querySelector('.btn-refresh').addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.refreshSingleCity(cityData.id);
        });

        // Добавляем обработчик для клика по карточке
        card.addEventListener('click', () => {
            this.showCityDetails(cityData);
        });

        return card;
    }

    async refreshSingleCity(cityId) {
        const element = document.querySelector(`[data-city-id="${cityId}"]`);
        if (!element) return;

        const cityData = {
            id: cityId,
            name: element.dataset.cityName,
            latitude: parseFloat(element.dataset.cityLat),
            longitude: parseFloat(element.dataset.cityLng)
        };

        const btn = element.querySelector('.btn-refresh');
        const originalHtml = btn.innerHTML;

        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;

        try {
            const weather = await this.weatherAPI.getWeather(cityData.latitude, cityData.longitude);
            cityData.weather = {
                temperature: weather.current_weather.temperature,
                windspeed: weather.current_weather.windspeed,
                weathercode: weather.current_weather.weathercode,
                time: weather.current_weather.time
            };

            this.updateCityElement(cityData);
            window.WeatherApp.showNotification(`Weather for ${cityData.name} updated!`, 'success');
        } catch (error) {
            window.WeatherApp.showNotification(`Failed to update ${cityData.name}: ${error.message}`, 'error');
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }

    showCityDetails(cityData) {
        // Создаем модальное окно с деталями
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>${cityData.name} Weather Details</h2>
                    <button class="modal-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div id="weather-chart" style="height: 300px; margin: 20px 0;">
                        <!-- Здесь будет график -->
                        <p>Hourly temperature chart would be displayed here.</p>
                    </div>
                    <div class="weather-stats">
                        <h3>Statistics</h3>
                        <div class="stats-grid">
                            <div class="stat-item">
                                <i class="fas fa-thermometer-half"></i>
                                <span>Current: ${cityData.weather?.temperature || '--'}°C</span>
                            </div>
                            <div class="stat-item">
                                <i class="fas fa-wind"></i>
                                <span>Wind: ${cityData.weather?.windspeed || '--'} km/h</span>
                            </div>
                            <div class="stat-item">
                                <i class="fas fa-map-pin"></i>
                                <span>Coordinates: ${cityData.latitude}, ${cityData.longitude}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Обработчик закрытия
        modal.querySelector('.modal-close').addEventListener('click', () => {
            modal.remove();
        });

        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    async searchAndAddCity(cityName) {
        try {
            const cityInfo = await this.weatherAPI.getCityCoordinates(cityName);
            const weather = await this.weatherAPI.getWeather(cityInfo.latitude, cityInfo.longitude);

            return {
                ...cityInfo,
                weather: {
                    temperature: weather.current_weather.temperature,
                    windspeed: weather.current_weather.windspeed,
                    weathercode: weather.current_weather.weathercode,
                    time: weather.current_weather.time
                }
            };
        } catch (error) {
            throw error;
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    const weatherUI = new WeatherUI();

    // Экспортируем для глобального использования
    window.weatherUI = weatherUI;

    // Автоматическое обновление каждые 5 минут
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            weatherUI.updateAllCities().catch(console.error);
        }
    }, 5 * 60 * 1000);

    // Обновление при возвращении на вкладку
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            weatherUI.updateAllCities().catch(console.error);
        }
    });
});