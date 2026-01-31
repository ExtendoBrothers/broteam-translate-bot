# Docker Deployment Guide

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- `.env` file with required credentials

## Quick Start

### 1. Create Environment File

Create a `.env` file in the project root:

```bash
# Twitter OAuth2 (Required)
TWITTER_OAUTH2_CLIENT_ID=your_client_id
TWITTER_CLIENT_ID=your_client_id
TWITTER_CLIENT_SECRET=your_client_secret
TWITTER_OAUTH2_ACCESS_TOKEN=your_access_token
TWITTER_OAUTH2_REFRESH_TOKEN=your_refresh_token

# Bot Configuration (Required)
TRANSLATE_FROM_USERNAME=source_account
TARGET_LANGUAGES=es,fr,de,pt,nl,it,pl

# Translation Service
LIBRETRANSLATE_URL=http://libretranslate:5000

# Optional: Twitter OAuth1 Fallback
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=

# Optional: LLM Enhancement
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Optional: Performance
ENABLE_PERFORMANCE_METRICS=true
FETCH_INTERVAL_MS=300000
POST_REPLY_DELAY_MS=2000
MAX_TWEETS_PER_FETCH=10
LOG_LEVEL=info
```

### 2. Build and Start Services

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f bot
docker-compose logs -f libretranslate
```

### 3. Verify Services

```bash
# Check service status
docker-compose ps

# Check health
docker-compose exec bot node -e "require('http').get('http://localhost:3000/health', r => console.log(r.statusCode))"

# Check LibreTranslate
curl http://localhost:5000/languages
```

## Service Management

### Start Services

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d bot
docker-compose up -d libretranslate
```

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Stop specific service
docker-compose stop bot
```

### Restart Services

```bash
# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart bot
```

### View Logs

```bash
# View all logs
docker-compose logs

# Follow logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f bot

# View last 100 lines
docker-compose logs --tail=100 bot
```

## Updating the Bot

### Update Code

```bash
# Pull latest changes
git pull origin development

# Rebuild bot image
docker-compose build bot

# Restart bot service
docker-compose up -d bot
```

### Update Configuration

```bash
# Edit .env file
nano .env

# Restart bot to apply changes
docker-compose restart bot
```

## Troubleshooting

### Bot Not Starting

1. Check logs:
   ```bash
   docker-compose logs bot
   ```

2. Verify environment variables:
   ```bash
   docker-compose exec bot env | grep TWITTER
   ```

3. Check LibreTranslate dependency:
   ```bash
   docker-compose ps libretranslate
   docker-compose logs libretranslate
   ```

### LibreTranslate Errors

1. Check service status:
   ```bash
   docker-compose ps libretranslate
   ```

2. Test translation endpoint:
   ```bash
   curl -X POST http://localhost:5000/translate \
     -H "Content-Type: application/json" \
     -d '{"q":"Hello","source":"en","target":"es"}'
   ```

3. Restart with model update:
   ```bash
   docker-compose down libretranslate
   docker-compose up -d libretranslate
   ```

### OAuth Token Issues

1. Check token file:
   ```bash
   cat .twitter-oauth2-tokens.json
   ```

2. Verify token permissions:
   ```bash
   ls -la .twitter-oauth2-tokens.json
   ```

3. Re-authorize if needed:
   ```bash
   npm run oauth2:auth
   ```

### Performance Issues

1. Enable metrics:
   ```bash
   # In .env file
   ENABLE_PERFORMANCE_METRICS=true
   ```

2. View performance logs:
   ```bash
   docker-compose logs bot | grep "Performance"
   ```

3. Check resource usage:
   ```bash
   docker stats
   ```

## Data Management

### Backup Data

```bash
# Backup volumes
docker run --rm -v broteam-translate-bot_bot-data:/data -v $(pwd):/backup alpine tar czf /backup/bot-data-backup.tar.gz -C /data .

# Backup logs
docker run --rm -v broteam-translate-bot_bot-logs:/logs -v $(pwd):/backup alpine tar czf /backup/bot-logs-backup.tar.gz -C /logs .

# Backup OAuth tokens
cp .twitter-oauth2-tokens.json .twitter-oauth2-tokens.json.backup
```

### Restore Data

```bash
# Restore volumes
docker run --rm -v broteam-translate-bot_bot-data:/data -v $(pwd):/backup alpine tar xzf /backup/bot-data-backup.tar.gz -C /data

# Restore OAuth tokens
cp .twitter-oauth2-tokens.json.backup .twitter-oauth2-tokens.json
```

### Clean Up

```bash
# Remove stopped containers
docker-compose rm

# Remove unused images
docker image prune

# Remove all (including volumes)
docker-compose down -v --rmi all
```

## Production Deployment

### Recommended Configuration

1. **Resource Limits**
   
   Add to `docker-compose.yml`:
   ```yaml
   bot:
     deploy:
       resources:
         limits:
           cpus: '1.0'
           memory: 1G
         reservations:
           cpus: '0.5'
           memory: 512M
   ```

2. **Restart Policy**
   
   Already configured:
   ```yaml
   restart: unless-stopped
   ```

3. **Log Rotation**
   
   Already configured:
   ```yaml
   logging:
     driver: "json-file"
     options:
       max-size: "10m"
       max-file: "3"
   ```

4. **Health Checks**
   
   Already configured for both services

### Security Hardening

1. **Use secrets for sensitive data**:
   ```bash
   # Create Docker secrets
   echo "your_client_id" | docker secret create twitter_client_id -
   ```

2. **Run as non-root user** (add to Dockerfile):
   ```dockerfile
   RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
   USER nodejs
   ```

3. **Use read-only filesystem**:
   ```yaml
   bot:
     read_only: true
     tmpfs:
       - /tmp
   ```

### Monitoring

1. **Prometheus Metrics** (future enhancement):
   ```yaml
   bot:
     ports:
       - "9090:9090"
   ```

2. **Health Check Endpoint**:
   ```bash
   curl http://localhost:3000/health
   ```

3. **Container Stats**:
   ```bash
   docker stats bot libretranslate
   ```

## Advanced Usage

### Custom Network

```bash
# Create external network
docker network create translate-net

# Update docker-compose.yml
networks:
  translate-network:
    external:
      name: translate-net
```

### Multiple Bot Instances

```bash
# Scale bot service
docker-compose up -d --scale bot=3
```

Note: Requires load balancing and coordination

### Custom Build Args

```bash
# Build with custom Node version
docker-compose build --build-arg NODE_VERSION=18.20.0 bot
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build and deploy
        run: |
          docker-compose build
          docker-compose up -d
```

## Support

For issues and questions:
- GitHub Issues: https://github.com/ExtendoBrothers/broteam-translate-bot/issues
- Documentation: See README.md and ARCHITECTURE.md
