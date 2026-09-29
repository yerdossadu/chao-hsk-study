FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHAO_DATA_DIR=/var/data \
    OCR_LANG=chi_sim+rus+eng

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-rus tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py lesson_validation.py layout.py app.html manager.html ./
RUN mkdir -p /var/data

EXPOSE 10000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "10000"]
