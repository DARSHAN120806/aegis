FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock && useradd --uid 10001 --create-home aegis
COPY app ./app
COPY migrations ./migrations
RUN mkdir -p /data && chown -R aegis:aegis /data /app
USER aegis
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
