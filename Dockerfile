FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the app
COPY . .

# AIC Cloud (and most hosts) set PORT automatically; 8000 is the local default
ENV PORT=8000
EXPOSE 8000

CMD ["python", "server.py"]
