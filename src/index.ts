import { app } from "./api/webhook";
import { logger } from "./utils/logger";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
});
