import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    # Обязательные переменные (если их нет в .env или настройках хостинга - будет ошибка)
    BOT_TOKEN: str
    WEBAPP_URL: str
    
    # Необязательные (есть значения по умолчанию)
    ADMIN_IDS: str = ""
    DATABASE_URL: str = "sqlite+aiosqlite:///./casino.db"
    SECRET_KEY: str = "change_me_to_random_string"

    # Превращаем строку "123,456" в список чисел [123, 456]
    @property
    def admin_ids_list(self) -> List[int]:
        if not self.ADMIN_IDS:
            return []
        return [int(x) for x in self.ADMIN_IDS.split(",") if x.strip().isdigit()]

    # Настройки Pydantic: читать файл .env, игнорировать лишние переменные
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

# Создаем объект настроек, который будем импортировать в других файлах
settings = Settings()
