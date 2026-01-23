#!/bin/bash
# setup.sh

echo "🚀 Setting up Chat Backend..."

# 1. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 2. Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs uploads/{images,files} nginx ssl

# 3. Check if Docker is installed
if command -v docker &> /dev/null; then
    echo "🐳 Docker detected. Starting services with Docker Compose..."
    docker-compose up -d
    
    echo "⏳ Waiting for services to start..."
    sleep 10
    
    # Check if services are running
    if docker ps | grep -q "chat-mongodb"; then
        echo "✅ MongoDB is running"
    else
        echo "❌ MongoDB failed to start"
    fi
    
    if docker ps | grep -q "chat-redis"; then
        echo "✅ Redis is running"
    else
        echo "❌ Redis failed to start"
    fi
else
    echo "ℹ️ Docker not found. Please install:"
    echo "  - macOS: brew install docker docker-compose"
    echo "  - Ubuntu: sudo apt install docker.io docker-compose"
    echo "  - Windows: https://docs.docker.com/desktop/install/windows-install/"
    echo ""
    echo "Or run services manually:"
    echo "  - MongoDB: mongod"
    echo "  - Redis: redis-server"
fi

# 4. Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📄 Creating .env file..."
    cat > .env << EOF
PORT=5000
MONGODB_URI=mongodb://localhost:27017/chatdb
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_EXPIRES_IN=7d
REDIS_HOST=localhost
REDIS_PORT=6379
CLIENT_URL=http://localhost:3000
EOF
    echo "⚠️  Please edit .env with your actual values!"
fi

# 5. Seed database (optional)
read -p "Do you want to seed the database with test data? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🌱 Seeding database..."
    npm run seed
fi

echo ""
echo "✅ Setup complete!"
echo "📋 Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Start the server: npm run dev"
echo "3. Open browser to: http://localhost:5000/health"
echo ""
echo "📞 For WebSocket testing:"
echo "   Use a tool like Postman WebSocket or Socket.io client"