FROM python:3.12-slim
WORKDIR /service
RUN pip install --no-cache-dir "fastapi>=0.115,<1.0" "uvicorn>=0.30,<1.0"
COPY backend/mock_backend ./mock_backend
EXPOSE 8001
CMD ["uvicorn", "mock_backend.main:app", "--host", "0.0.0.0", "--port", "8001"]
