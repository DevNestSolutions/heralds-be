const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

console.log('--- SYSTEM CHECK ---');
console.log('OpenAI Key Loaded:', process.env.OPENAI_API_KEY ? 'YES (Starts with ' + process.env.OPENAI_API_KEY.substring(0, 7) + '...)' : 'NO');
console.log('--------------------');

app.use(cors());
// Increased limit carefully to accept base64 image strings
app.use(express.json({ limit: '10mb' }));

const { Pool } = require('pg');
const cloudinary = require('cloudinary');
const multer = require('multer');
const CloudinaryStorage = require('multer-storage-cloudinary');

// Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer Storage for Cloudinary
const storage = CloudinaryStorage({
  cloudinary: cloudinary,
  folder: 'heralds_products',
  allowedFormats: ['jpg', 'png', 'jpeg', 'webp']
});
const upload = multer({ storage: storage });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- DATABASE INITIALIZATION ---
const initDB = async () => {
  console.log('Connecting to PostgreSQL...');
  try {
    // Create Categories Table
    console.log('Ensuring Categories table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        name TEXT PRIMARY KEY
      )
    `);

    // Create Products Table
    console.log('Ensuring Products table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        category TEXT REFERENCES categories(name),
        styles TEXT[],
        description TEXT,
        images TEXT[],
        customizable BOOLEAN DEFAULT false,
        is_new BOOLEAN DEFAULT false,
        is_trending BOOLEAN DEFAULT false
      )
    `);

    // Create Orders Table
    console.log('Ensuring Orders table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer JSONB NOT NULL,
        config JSONB,
        image_url TEXT,
        total INTEGER,
        status TEXT DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed Categories if empty
    const catCheck = await pool.query('SELECT count(*) FROM categories');
    if (parseInt(catCheck.rows[0].count) === 0) {
      console.log('Seeding categories...');
      const initialCats = ['Shirts', 'T-Shirts', 'Hoodies', 'Pants', 'Shorts'];
      for (const cat of initialCats) {
        await pool.query('INSERT INTO categories (name) VALUES ($1)', [cat]);
      }
    }

    // Seed Products if empty
    const prodCheck = await pool.query('SELECT count(*) FROM products');
    if (parseInt(prodCheck.rows[0].count) === 0) {
      console.log('Seeding initial product...');
      const initialProd = {
        name: 'Premium Oxford Button-Down',
        price: 4500,
        category: 'Shirts',
        styles: ['Smart Casual', 'Minimal Style'],
        description: 'A timeless staple for the modern wardrobe. Made from high-quality Oxford cotton.',
        images: ['https://cdn.pixabay.com/photo/2017/10/11/14/32/blur-2841225_1280.jpg'],
        customizable: true,
        is_new: false,
        is_trending: true
      };
      await pool.query(
        'INSERT INTO products (name, price, category, styles, description, images, customizable, is_new, is_trending) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [initialProd.name, initialProd.price, initialProd.category, initialProd.styles, initialProd.description, initialProd.images, initialProd.customizable, initialProd.is_new, initialProd.is_trending]
      );
    }

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database Init ERROR:', err.message);
  }
};

initDB();

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id DESC');

    const formatted = result.rows.map(p => ({
      ...p,
      // Ensure images and styles are arrays even if NULL
      images: Array.isArray(p.images) ? p.images : (p.images ? [p.images] : []),
      styles: Array.isArray(p.styles) ? p.styles : (p.styles ? [p.styles] : []),
      isNew: p.is_new,
      isTrending: p.is_trending
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM categories ORDER BY name');
    res.json(result.rows.map(r => r.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const axios = require('axios');

// AI Image Generation Endpoint
app.post('/api/generate-shirt', async (req, res) => {
  try {
    const { options } = req.body;
    let prompt = `${options.shirtColorName || options.shirtColor} ${options.fitType} shirt, ${options.sleeveType}, ${options.collarType}, ${options.pocket}, minimal streetwear fashion, centered front-facing t-shirt mockup, realistic clothing product photography, studio lighting, clean white background, high detail`;
    if (options.enableText && options.customText) {
      prompt += `, with text "${options.customText}" printed on chest`;
    }

    const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

    // Check if Cloudflare credentials are placeholder/invalid
    const isPlaceholder = !ACCOUNT_ID || !API_TOKEN || 
                          ACCOUNT_ID.includes('aselak30') || 
                          API_TOKEN === '12345678';

    if (isPlaceholder) {
      console.log('[AI Customizer] Placeholder credentials detected. Serving pre-curated high-quality mockup...');
      
      // Look up curated clothing image depending on options selected
      let imageUrl = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&q=80&w=800'; // Default White
      
      const color = (options.shirtColorName || '').toLowerCase();
      const isLongSleeve = (options.sleeveType || '').toLowerCase().includes('long');

      if (color.includes('black')) {
        imageUrl = isLongSleeve 
          ? 'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&q=80&w=800' 
          : 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&q=80&w=800';
      } else if (color.includes('white')) {
        imageUrl = isLongSleeve 
          ? 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&q=80&w=800' 
          : 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&q=80&w=800';
      } else if (color.includes('navy') || color.includes('blue')) {
        imageUrl = 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&q=80&w=800';
      } else if (color.includes('burgundy') || color.includes('red')) {
        imageUrl = 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&q=80&w=800';
      } else if (color.includes('olive') || color.includes('green')) {
        imageUrl = 'https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&q=80&w=800';
      }

      // Download the curated image and return it as buffer
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      res.setHeader('Content-Type', 'image/jpeg');
      return res.send(response.data);
    }

    const response = await axios.post(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0`,
      { prompt },
      { headers: { 'Authorization': `Bearer ${API_TOKEN}` }, responseType: 'arraybuffer' }
    );

    res.setHeader('Content-Type', 'image/png');
    res.send(response.data);
  } catch (err) {
    const errMsg = err.response && err.response.data ? err.response.data.toString() : err.message;
    console.error('AI Generation Error:', errMsg);
    res.status(500).json({ success: false, message: `AI generation failed: ${errMsg}` });
  }
});

// Custom Order (Internal save)
app.post('/api/custom-order', async (req, res) => {
  try {
    const { orderDetails, configuration, imageUrl, total } = req.body;
    await pool.query(
      'INSERT INTO orders (customer, config, image_url, total) VALUES ($1, $2, $3, $4)',
      [orderDetails, configuration, imageUrl, total || 5000]
    );
    res.status(200).json({ success: true, message: 'Order received' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- ADMIN API (PRODUCT & CATEGORY) ---

// Categories
app.post('/api/admin/categories', async (req, res) => {
  const { category, action } = req.body;
  try {
    if (action === 'add') {
      await pool.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING', [category]);
    } else {
      await pool.query('DELETE FROM categories WHERE name = $1', [category]);
    }
    const result = await pool.query('SELECT name FROM categories ORDER BY name');
    res.json({ success: true, categories: result.rows.map(r => r.name) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Products
app.post('/api/admin/products', async (req, res) => {
  const { action, product } = req.body;
  try {
    if (action === 'add') {
      await pool.query(
        'INSERT INTO products (name, price, category, styles, description, images, customizable, is_new, is_trending) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [product.name, product.price, product.category, product.styles, product.description, product.images, product.customizable, product.isNew, product.isTrending]
      );
    } else if (action === 'edit') {
      await pool.query(
        'UPDATE products SET name=$1, price=$2, category=$3, styles=$4, description=$5, images=$6, customizable=$7, is_new=$8, is_trending=$9 WHERE id=$10',
        [product.name, product.price, product.category, product.styles, product.description, product.images, product.customizable, product.isNew, product.isTrending, product.id]
      );
    } else if (action === 'delete') {
      await pool.query('DELETE FROM products WHERE id = $1', [product.id]);
    }

    const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
    const formatted = result.rows.map(p => ({
      ...p,
      isNew: p.is_new,
      isTrending: p.is_trending
    }));
    res.json({ success: true, products: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload Endpoint
app.post('/api/admin/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    console.log('File Uploaded:', req.file);
    // In some versions it is .url, in some it is .path
    const imageUrl = req.file.path || req.file.url || req.file.secure_url;
    res.json({ success: true, url: imageUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('Heralds Clothing API is running on PostgreSQL.');
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
  });
}

module.exports = app;
