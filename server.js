const http = require('http'); // 修正语法错误
const WebSocket = require('ws');

const server = http.createServer();
const wss = new WebSocket.Server({server});
console.log('WebSocket starting');

const map = new Map();
var connections = {};
var connectionIDCounter = 1000;

wss.on('connection', (socket) => {
    socket.id = connectionIDCounter++;
    connections[socket.id] = socket;
    console.log('WebSocket connected id:' + socket.id);

    socket.on('message', (message) => {
        try {
            // 解析 JSON 数据
            const jsonData = JSON.parse(message);

            switch (jsonData.code) {
                //创建房间
                case 1:
                    map.set(socket.id, 'init');
                    socket.send(JSON.stringify({
                        code: 1,
                        id: socket.id,
                        message: 'room created'
                    }));
                    break;

                //通过房间号获取字符串
                case 2:
                    if (map.has(jsonData.id)) {
                        socket.send(JSON.stringify({
                            code: 0,
                            message: map.get(jsonData.id)
                        }));
                    } else {
                        socket.send(JSON.stringify({
                            code: -1,
                            message: 'room not found'
                        }));
                    }
                    break;

                //更新数据
                case 3:
                    if (map.has(jsonData.id)) {
                        map.set(jsonData.id, jsonData.message);
                    }
                    break;

                //摧毁房间
                case 4:
                    map.delete(jsonData.id);
                    break;
            }

        } catch (parseError) {
            console.error('Error parsing JSON:', parseError);

            socket.send(JSON.stringify({
                code: -1,
                message: 'Error parsing JSON:' + parseError
            }));
        }
    });

    socket.on('close', () => {
        delete connections[socket.id];
        map.delete(socket.id);
        console.log('WebSocket closed id:' + socket.id);
    });
});

server.listen(1234, () => {
    console.log('Server listening on port 1234');
});