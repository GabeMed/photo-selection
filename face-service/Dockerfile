FROM python:3.12-slim AS models
ADD --checksum=sha256:80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f \
    https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip /tmp/buffalo_l.zip
RUN python -c "import zipfile; zipfile.ZipFile('/tmp/buffalo_l.zip').extractall('/models', ['det_10g.onnx', 'w600k_r50.onnx'])"

# Cloudflare Containers only run linux/amd64 images.
FROM --platform=linux/amd64 python:3.12-slim
ENV MODELS_DIR=/models \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=models /models /models
COPY app.py faces.py ./
RUN useradd --system --no-create-home face
USER face
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
