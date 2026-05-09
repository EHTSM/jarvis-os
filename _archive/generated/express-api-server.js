```javascript
const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

const users = [
  { id: 1, name: 'John Doe', email: 'john@example.com' },
  { id: 2, name: 'Jane Doe', email: 'jane@example.com' },
];

const router = express.Router();

router.get('/users', async (req, res) => {
  try {
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ message: 'Invalid user ID' });
      return;
    }
    const user = users.find((user) => user.id === id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      res.status(400).json({ message: 'Name and email are required' });
      return;
    }
    const newUser = { id: users.length + 1, name, email };
    users.push(newUser);
    res.json(newUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ message: 'Invalid user ID' });
      return;
    }
    const user = users.find((user) => user.id === id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    const { name, email } = req.body;
    if (name) user.name = name;
    if (email) user.email = email;
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ message: 'Invalid user ID' });
      return;
    }
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    users.splice(index, 1);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.use('/api', router);

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
```