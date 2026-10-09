import { app } from "./api/webhook";
import { getJwtSecret, getJwtExpiresIn } from "./auth/jwt";
import { getConfiguredCredentials } from "./auth/credentials";
import { logger } from "./utils/logger";

const PORT = process.env.PORT || 3000;

// Fail fast: refuse to start without auth configuration rather than run insecurely.
getJwtSecret();
getJwtExpiresIn();
getConfiguredCredentials();

app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
});
