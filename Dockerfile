# 1. 使用符合你 engines 規範的 Node.js 20 輕量版本
# Use a lightweight Node.js 20 version matching your engines specification
FROM node:20-slim

# 2. 設定容器內的工作目錄
# Set the working directory inside the container
WORKDIR /app

# 3. 先複製 package.json 與 lock 檔以利用 Docker 快取機制
# Copy package.json and lock files first to leverage Docker's caching mechanism
COPY package*.json ./

# 4. 安裝你的 dependencies (這裡會自動把 html2pdf.js 等所有套件抓下來)
# Install your dependencies (this automatically pulls html2pdf.js and all other packages)
RUN npm install

# 5. 複製其餘專案原始碼
# Copy the rest of the project source code
COPY . .

# 6. 開放 Quasar 開發伺服器或預設連接埠
# Expose the Quasar dev server or default port
EXPOSE 9000

# 7. 啟動 Quasar 開發指令，並透過 --host 0.0.0.0 確保外部容器可以連線
# Start Quasar dev command, ensuring external container connection via --host 0.0.0.0
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]