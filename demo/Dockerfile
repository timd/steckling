# Builds the Steckling demo agent as a container Railway can run.
FROM oven/bun:1

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json ./
RUN bun install

# The agent source.
COPY agent.ts ./

# `steck deploy` writes railway.json with the real startCommand (bun run
# agent.ts); this CMD is the standalone fallback if you `docker run` it directly.
CMD ["bun", "run", "agent.ts"]
