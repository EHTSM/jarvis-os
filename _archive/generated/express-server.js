```javascript
const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

const router = express.Router();

app.use('/api', router);

router.get('/', async (req, res) => {
    try {
        res.status(200).json({ message: 'Welcome to the API' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});

module.exports = app;
```