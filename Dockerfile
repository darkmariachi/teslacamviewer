# syntax=docker/dockerfile:1

# 1. Build the web app.
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Vite writes the bundle to ../server/wwwroot.
RUN npm run build

# 2. Build the server and bundle the web app into it.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY server/TeslaCam.csproj server/
RUN dotnet restore server/TeslaCam.csproj
COPY server/ server/
COPY --from=web /src/server/wwwroot server/wwwroot
RUN dotnet publish server/TeslaCam.csproj -c Release -o /app --no-restore

# 3. Runtime: ASP.NET plus ffmpeg and Intel's VAAPI driver for hardware encoding.
FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tzdata \
    && (apt-get install -y --no-install-recommends intel-media-va-driver-non-free || apt-get install -y --no-install-recommends intel-media-va-driver || true) \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .
ENV TESLACAM_ROOT=/teslacam \
    TESLACAM_DATA=/data \
    ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_gcServer=0
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["dotnet", "TeslaCam.dll"]
