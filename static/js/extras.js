// Дополнительные функции для приложения

// Автодополнение для поиска городов
class CityAutocomplete {
    constructor(inputElement, latElement = null, lonElement = null, options = {}) {
        this.input = inputElement;
        this.latInput = latElement;
        this.lonInput = lonElement;
        this.options = {
            minLength: 2,
            delay: 300,
            showCoordinates: true,
            ...options
        };

        this.init();
    }

    init() {
        this.container = document.createElement('div');
        this.container.className = 'autocomplete-container';
        this.container.style.cssText = `
            position: relative;
            width: 100%;
        `;

        this.input.parentNode.insertBefore(this.container, this.input);
        this.container.appendChild(this.input);

        this.dropdown = document.createElement('div');
        this.dropdown.className = 'autocomplete-dropdown';
        this.dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: white;
            border: 1px solid #ddd;
            border-top: none;
            border-radius: 0 0 8px 8px;
            max-height: 300px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;

        this.container.appendChild(this.dropdown);

        this.setupEventListeners();
    }

    setupEventListeners() {
        let timeout;

        this.input.addEventListener('input', (e) => {
            clearTimeout(timeout);

            const query = e.target.value.trim();
            if (query.length >= this.options.minLength) {
                timeout = setTimeout(() => {
                    this.searchCities(query);
                }, this.options.delay);
            } else {
                this.hideDropdown();
                this.clearCoordinates();
            }
        });

        this.input.addEventListener('focus', () => {
            if (this.input.value.length >= this.options.minLength) {
                this.searchCities(this.input.value);
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.hideDropdown();
            }
        });

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideDropdown();
            }

            // Навигация стрелками
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateDropdown(e.key === 'ArrowDown' ? 1 : -1);
            }

            if (e.key === 'Enter' && this.selectedItem) {
                e.preventDefault();
                this.selectItem(this.selectedItem);
            }
        });
    }

    navigateDropdown(direction) {
        const items = this.dropdown.querySelectorAll('.autocomplete-item');
        if (items.length === 0) return;

        if (!this.selectedIndex) this.selectedIndex = -1;

        this.selectedIndex += direction;

        // Зацикливание
        if (this.selectedIndex < 0) this.selectedIndex = items.length - 1;
        if (this.selectedIndex >= items.length) this.selectedIndex = 0;

        // Снимаем выделение с предыдущего элемента
        items.forEach(item => item.classList.remove('selected'));

        // Выделяем новый элемент
        this.selectedItem = items[this.selectedIndex];
        this.selectedItem.classList.add('selected');
        this.selectedItem.scrollIntoView({ block: 'nearest' });
    }

    async searchCities(query) {
        try {
            // Показываем индикатор загрузки
            this.showLoading();

            const response = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=15&language=ru&format=json`
            );

            if (!response.ok) {
                this.showError('Ошибка при поиске городов');
                return;
            }

            const data = await response.json();

            if (!data.results || data.results.length === 0) {
                this.showNoResults(query);
                return;
            }

            this.showResults(data.results);
        } catch (error) {
            console.error('Autocomplete error:', error);
            this.showError('Ошибка соединения');
        }
    }

    showLoading() {
        this.dropdown.innerHTML = `
            <div class="autocomplete-loading" style="padding: 20px; text-align: center; color: #666;">
                <i class="fas fa-spinner fa-spin"></i> Поиск городов...
            </div>
        `;
        this.dropdown.style.display = 'block';
    }

    showError(message) {
        this.dropdown.innerHTML = `
            <div class="autocomplete-error" style="padding: 15px; color: #e74c3c; text-align: center;">
                <i class="fas fa-exclamation-circle"></i> ${message}
            </div>
        `;
        this.dropdown.style.display = 'block';
    }

    showNoResults(query) {
        this.dropdown.innerHTML = `
            <div class="autocomplete-no-results" style="padding: 20px; text-align: center; color: #666;">
                <i class="fas fa-search"></i> Не найдено городов по запросу "${query}"
            </div>
        `;
        this.dropdown.style.display = 'block';
    }

    showResults(cities) {
        this.dropdown.innerHTML = '';

        // Группируем города по странам
        const groupedByCountry = cities.reduce((acc, city) => {
            if (!acc[city.country]) acc[city.country] = [];
            acc[city.country].push(city);
            return acc;
        }, {});

        Object.entries(groupedByCountry).forEach(([country, countryCities]) => {
            // Заголовок страны
            const countryHeader = document.createElement('div');
            countryHeader.className = 'autocomplete-country';
            countryHeader.style.cssText = `
                padding: 8px 12px;
                background: #f8f9fa;
                font-weight: 600;
                font-size: 0.85em;
                color: #2c3e50;
                border-bottom: 1px solid #eee;
            `;
            countryHeader.textContent = this.getCountryName(country);
            this.dropdown.appendChild(countryHeader);

            // Города этой страны
            countryCities.forEach(city => {
                const item = this.createCityItem(city);
                this.dropdown.appendChild(item);
            });
        });

        this.dropdown.style.display = 'block';
    }

    getCountryName(countryCode) {
        const countries = {
            'RU': 'Россия',
            'UA': 'Украина',
            'BY': 'Беларусь',
            'KZ': 'Казахстан',
            'US': 'США',
            'GB': 'Великобритания',
            'DE': 'Германия',
            'FR': 'Франция',
            'IT': 'Италия',
            'ES': 'Испания',
            'TR': 'Турция',
            'CN': 'Китай',
            'JP': 'Япония',
            // Добавьте другие страны при необходимости
        };

        return countries[countryCode] || countryCode;
    }

    createCityItem(city) {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.style.cssText = `
            padding: 12px;
            cursor: pointer;
            transition: background-color 0.2s;
            border-bottom: 1px solid #f5f5f5;
        `;

        item.dataset.latitude = city.latitude;
        item.dataset.longitude = city.longitude;
        item.dataset.name = city.name;
        item.dataset.country = city.country;

        // Определяем иконку для типа населенного пункта
        const typeIcon = this.getTypeIcon(city.feature_code);
        const populationText = city.population ?
            `• Население: ${this.formatPopulation(city.population)}` : '';

        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="color: #3498db; font-size: 1.2em;">
                    ${typeIcon}
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 2px;">${city.name}</div>
                    <div style="font-size: 0.85em; color: #666;">
                        ${city.admin1 ? city.admin1 + ', ' : ''}${this.getCountryName(city.country)}
                        ${populationText}
                    </div>
                    ${this.options.showCoordinates ? `
                        <div style="font-size: 0.75em; color: #888; margin-top: 4px;">
                            <i class="fas fa-map-marker-alt"></i>
                            ${city.latitude.toFixed(4)}, ${city.longitude.toFixed(4)}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Эффекты при наведении
        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = '#f0f7ff';
        });

        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = 'transparent';
        });

        // Обработчик клика
        item.addEventListener('click', () => {
            this.selectItem(item);
        });

        return item;
    }

    getTypeIcon(featureCode) {
        const icons = {
            'PPLC': '<i class="fas fa-landmark"></i>', // Столица
            'PPLA': '<i class="fas fa-city"></i>', // Административный центр
            'PPL': '<i class="fas fa-building"></i>', // Город/поселок
            'PPLF': '<i class="fas fa-village"></i>', // Деревня
            'ADM1': '<i class="fas fa-globe-europe"></i>', // Регион
            'ADM2': '<i class="fas fa-map"></i>', // Район
        };

        return icons[featureCode] || '<i class="fas fa-map-pin"></i>';
    }

    formatPopulation(population) {
        if (population >= 1000000) {
            return (population / 1000000).toFixed(1) + ' млн';
        } else if (population >= 1000) {
            return (population / 1000).toFixed(0) + ' тыс';
        }
        return population;
    }

    selectItem(item) {
        const cityName = item.dataset.name;
        const latitude = item.dataset.latitude;
        const longitude = item.dataset.longitude;

        this.input.value = cityName;

        // Заполняем поля координат если они есть
        if (this.latInput && this.lonInput) {
            this.latInput.value = latitude;
            this.lonInput.value = longitude;

            // Добавляем анимацию подтверждения
            this.animateCoordinates();
        }

        this.hideDropdown();

        // Генерируем событие выбора
        this.input.dispatchEvent(new CustomEvent('citySelected', {
            detail: {
                name: cityName,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                country: item.dataset.country
            }
        }));
    }

    clearCoordinates() {
        if (this.latInput && this.lonInput) {
            this.latInput.value = '';
            this.lonInput.value = '';
        }
    }

    animateCoordinates() {
        if (this.latInput && this.lonInput) {
            // Мигание зеленым цветом
            [this.latInput, this.lonInput].forEach(input => {
                input.style.transition = 'all 0.3s';
                input.style.boxShadow = '0 0 0 2px rgba(46, 204, 113, 0.3)';
                input.style.borderColor = '#2ecc71';

                setTimeout(() => {
                    input.style.boxShadow = '';
                    input.style.borderColor = '';
                }, 1000);
            });
        }
    }

    hideDropdown() {
        this.dropdown.style.display = 'none';
        this.selectedIndex = null;
        this.selectedItem = null;
    }
}

// Расширенная функция для инициализации формы добавления города
function initAddCityForm() {
    const addCityForm = document.getElementById('add-city-form');
    if (!addCityForm) return;

    const cityInput = document.getElementById('city-name-input');
    const latInput = document.getElementById('latitude-input');
    const lonInput = document.getElementById('longitude-input');

    if (!cityInput || !latInput || !lonInput) return;

    // Инициализируем автодополнение
    const autocomplete = new CityAutocomplete(cityInput, latInput, lonInput, {
        minLength: 2,
        delay: 200,
        showCoordinates: true
    });

    // Кнопка определения местоположения
    const detectLocationBtn = document.getElementById('detect-location-btn');
    if (detectLocationBtn) {
        detectLocationBtn.addEventListener('click', detectUserLocation);
    }

    // Кнопка проверки погоды
    const testWeatherBtn = document.getElementById('test-weather-btn');
    if (testWeatherBtn) {
        testWeatherBtn.addEventListener('click', testWeatherForCoordinates);
    }

    // Обработчик события выбора города
    cityInput.addEventListener('citySelected', (e) => {
        const city = e.detail;
        console.log('Выбран город:', city);

        // Можно добавить дополнительные действия
        // Например, автоматическую проверку погоды
        if (testWeatherBtn) {
            setTimeout(() => testWeatherBtn.click(), 500);
        }
    });
}

// Функция определения местоположения пользователя
function detectUserLocation() {
    const cityInput = document.getElementById('city-name-input');
    const latInput = document.getElementById('latitude-input');
    const lonInput = document.getElementById('longitude-input');

    if (!navigator.geolocation) {
        alert('Геолокация не поддерживается вашим браузером');
        return;
    }

    const detectBtn = document.getElementById('detect-location-btn');
    const originalText = detectBtn.innerHTML;

    detectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Определение...';
    detectBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            latInput.value = lat.toFixed(4);
            lonInput.value = lon.toFixed(4);

            // Пробуем получить название города по координатам
            reverseGeocode(lat, lon)
                .then(cityName => {
                    if (cityName) {
                        cityInput.value = cityName;
                    } else {
                        cityInput.value = 'Мое местоположение';
                    }

                    detectBtn.innerHTML = '<i class="fas fa-check-circle"></i> Найдено!';
                    setTimeout(() => {
                        detectBtn.innerHTML = originalText;
                        detectBtn.disabled = false;
                    }, 1500);
                })
                .catch(() => {
                    cityInput.value = 'Мое местоположение';
                    detectBtn.innerHTML = '<i class="fas fa-check-circle"></i> Найдено!';
                    setTimeout(() => {
                        detectBtn.innerHTML = originalText;
                        detectBtn.disabled = false;
                    }, 1500);
                });
        },
        (error) => {
            console.error('Geolocation error:', error);

            let errorMessage = 'Не удалось определить местоположение';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = 'Доступ к геолокации запрещен';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = 'Информация о местоположении недоступна';
                    break;
                case error.TIMEOUT:
                    errorMessage = 'Время определения истекло';
                    break;
            }

            showNotification(errorMessage, 'error');
            detectBtn.innerHTML = originalText;
            detectBtn.disabled = false;
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// Обратное геокодирование (координаты → название города)
async function reverseGeocode(latitude, longitude) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=ru`
        );

        if (!response.ok) return null;

        const data = await response.json();

        if (data.address) {
            // Пробуем получить название города из разных полей
            return data.address.city ||
                   data.address.town ||
                   data.address.village ||
                   data.address.municipality ||
                   data.address.county ||
                   null;
        }

        return null;
    } catch (error) {
        console.error('Reverse geocoding error:', error);
        return null;
    }
}

// Функция тестирования погоды для координат
async function testWeatherForCoordinates() {
    const latInput = document.getElementById('latitude-input');
    const lonInput = document.getElementById('longitude-input');
    const cityInput = document.getElementById('city-name-input');

    if (!latInput || !lonInput) {
        showNotification('Введите координаты', 'warning');
        return;
    }

    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);

    if (isNaN(lat) || isNaN(lon)) {
        showNotification('Введите корректные координаты', 'error');
        return;
    }

    const testBtn = document.getElementById('test-weather-btn');
    const originalText = testBtn.innerHTML;

    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Проверка...';
    testBtn.disabled = true;

    try {
        const response = await fetch(`/api/test-weather?latitude=${lat}&longitude=${lon}`);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ошибка при проверке погоды');
        }

        const data = await response.json();

        showNotification(
            `Температура: ${data.temperature}°C (${cityInput.value || 'эти координаты'})`,
            'success'
        );

        testBtn.innerHTML = '<i class="fas fa-check-circle"></i> Успешно!';
        setTimeout(() => {
            testBtn.innerHTML = originalText;
            testBtn.disabled = false;
        }, 2000);

    } catch (error) {
        showNotification(error.message, 'error');
        testBtn.innerHTML = originalText;
        testBtn.disabled = false;
    }
}

// Вспомогательная функция для уведомлений
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#2ecc71' : type === 'error' ? '#e74c3c' : '#3498db'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        animation: slideIn 0.3s ease;
        max-width: 400px;
    `;

    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    // Инициализация автодополнения для главного поиска
    const searchInput = document.getElementById('city-search-input');
    if (searchInput) {
        new CityAutocomplete(searchInput);
    }

    // Инициализация формы добавления города
    initAddCityForm();

    // Инициализация графиков (если используется Chart.js)
    if (typeof Chart !== 'undefined') {
        initWeatherCharts();
    }

    // Добавляем CSS анимации для уведомлений
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }

            .autocomplete-item.selected {
                background-color: #e3f2fd !important;
                border-left: 3px solid #3498db;
            }
        `;
        document.head.appendChild(style);
    }
});

function initWeatherCharts() {
    const chartElements = document.querySelectorAll('.weather-chart');

    chartElements.forEach(element => {
        const ctx = element.getContext('2d');
        const cityId = element.dataset.cityId;

        loadWeatherDataForChart(cityId, ctx);
    });
}

async function loadWeatherDataForChart(cityId, ctx) {
    try {
        const response = await fetch(`/api/weather/${cityId}/history`);
        const data = await response.json();

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Temperature (°C)',
                    data: data.temperatures,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading chart data:', error);
    }
}

// Пример HTML формы для добавления города с улучшенным интерфейсом:
/*
<div class="add-city-form" id="add-city-form">
    <div class="form-group">
        <label for="city-name-input">
            <i class="fas fa-city"></i> Название города
        </label>
        <input type="text" id="city-name-input" class="form-control"
               placeholder="Начните вводить название города..." required>
        <small class="form-text">Автодополнение подскажет города со всего мира</small>
    </div>

    <div class="form-row">
        <div class="form-group">
            <label for="latitude-input">
                <i class="fas fa-map-marker-alt"></i> Широта
            </label>
            <input type="number" id="latitude-input" class="form-control"
                   step="0.0001" placeholder="55.7558" required>
        </div>

        <div class="form-group">
            <label for="longitude-input">
                <i class="fas fa-map-marker-alt"></i> Долгота
            </label>
            <input type="number" id="longitude-input" class="form-control"
                   step="0.0001" placeholder="37.6173" required>
        </div>
    </div>

    <div class="form-actions">
        <button type="button" id="detect-location-btn" class="btn btn-outline">
            <i class="fas fa-location-arrow"></i> Мое местоположение
        </button>

        <button type="button" id="test-weather-btn" class="btn btn-outline">
            <i class="fas fa-thermometer-half"></i> Проверить погоду
        </button>

        <button type="submit" class="btn btn-success">
            <i class="fas fa-plus"></i> Добавить город
        </button>
    </div>
</div>
*/

// Экспорт для использования в консоли разработчика
window.WeatherExtras = {
    CityAutocomplete,
    initAddCityForm,
    detectUserLocation,
    testWeatherForCoordinates
};