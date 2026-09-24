# Airflow 3.3.2 (pinned baseline) + JRE 17 for Spark.
# uv is installed into the airflow user's bin by pip (previous layer); the
# `uv` binary is standalone and works for the root runtime user via PATH.
FROM apache/airflow:3.3.2

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sfn /usr/lib/jvm/java-17-openjdk-* /usr/lib/jvm/default-java
# Architecture-neutral path (arm64 vs amd64) via the symlink above.
ENV JAVA_HOME=/usr/lib/jvm/default-java

USER airflow
RUN pip install --no-cache-dir uv
