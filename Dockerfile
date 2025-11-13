# Use official Python 3.11 slim base image
FROM python:3.11-slim

# Set working directory inside the container
WORKDIR /app

# Copy requirements file and install dependencies
# This leverages Docker's cache: installation is only run if the file changes
COPY requirements.txt .
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY app.py .
COPY images/ images/
COPY .streamlit/ .streamlit/

# Create .streamlit configuration directory if it doesn't exist
RUN mkdir -p .streamlit

# Copy .streamlit/config.toml file
COPY .streamlit/config.toml .streamlit/config.toml

# Tell Docker that the container listens on port 8501
EXPOSE 8501

# Health check - ensures container is running properly
HEALTHCHECK CMD curl --fail http://localhost:8501/_stcore/health || exit 1

# Command executed when the container starts
# --server.address=0.0.0.0 is important to make the service accessible from outside the container
CMD ["streamlit", "run", "app.py", "--client.showErrorDetails=false", "--client.toolbarMode=minimal"]