FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY www ./www

CMD ["gunicorn", "-b", "0.0.0.0:80", "app:app"]
