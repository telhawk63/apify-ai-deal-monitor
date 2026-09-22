FROM apify/actor-node-playwright-chrome:22

COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false && npm install --omit=dev --audit=false
COPY --chown=myuser:myuser . ./

CMD ["npm", "start", "--silent"]
