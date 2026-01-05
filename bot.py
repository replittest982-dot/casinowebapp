from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart
from aiogram.types import WebAppInfo
from config import settings

bot = Bot(token=settings.BOT_TOKEN)
dp = Dispatcher()

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    # Кнопка ведет на наш сайт
    kb = types.InlineKeyboardMarkup(inline_keyboard=[
        [types.InlineKeyboardButton(
            text="🎰 ИГРАТЬ В КАЗИНО", 
            web_app=WebAppInfo(url=settings.WEBAPP_URL)
        )]
    ])
    await message.answer(
        "🚀 <b>Добро пожаловать в Elite Crypto Casino!</b>\n\n"
        "Нажми кнопку ниже, чтобы открыть полное приложение.",
        parse_mode="HTML",
        reply_markup=kb
    )

async def start_bot():
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)

async def stop_bot():
    await bot.session.close()
