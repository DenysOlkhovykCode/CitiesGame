const { randomInt } = require("crypto");
var express = require("express");
var app = express();
var http = require("http").Server(app);
var io = require("socket.io")(http);
app.use(express.static("public"));
const mysql = require("mysql");
const connection = mysql.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: "",
  database: "cities",
});
var games = {};

app.get("/", function (req, res) {
  res.sendFile(__dirname + "/index.html");
});

// Генерувати унікальний ідентифікатор
function generateUniqueId() {
  return Math.random().toString(36).substr(2, 9);
}

io.on("connection", function (socket) {
  socket.on("create game", function () {
    const gameId = generateUniqueId(); // Генеруємо унікальний ідентифікатор гри
    games[gameId] = {
      creator: socket.id,
      players: [socket.id], // Починаємо гру з першим гравцем
      turn: 0, // Лічильник ходу для цієї гри
      mentionedCities: [], // Створення списку міст для даної гри
    };
    socket.emit("game created", gameId);
  });

  socket.on("join game", function (gameId) {
    if (games[gameId]) {
      socket.emit("game joined", gameId);
      games[gameId].players.push(socket.id);
      games[gameId].players.forEach((playerId) => {
        io.to(playerId).emit("players count", games[gameId].players.length);
      });
      if (games[gameId].players.length > 1) {
        io.to(games[gameId].creator).emit(
          "game can start",
          games[gameId].players.length
        );
      }
    } else {
      socket.emit("game not found");
    }
  });

  socket.on("start game", function (gameId) {
    const game = games[gameId];
    NextTurn(game);
  });

  function NextTurn(game) {
    game.players.forEach((playerId, index) => {
      if (index === game.turn) {
        // Створюємо об'єкт даних для передачі гравцю, який має наступний хід
        let data = {
          message: 0, // Код повідомлення про початок ходу
          lastCity: game.mentionedCities[game.mentionedCities.length - 1], // Останнє згадане місто
        };
        // Відправляємо повідомлення про початок ходу гравцю
        io.to(playerId).emit("turn", data);
      } else {
        // Відправляємо повідомлення про початок гри іншим гравцям
        io.to(playerId).emit(
          "game started",
          game.mentionedCities[game.mentionedCities.length - 1] // Останнє згадане місто
        );
      }
    });
  }

  function ErrorTurn(game, code) {
    // Створюємо об'єкт даних для відправки клієнту
    let data = {
      message: code, // Код повідомлення про неправильний хід
      lastCity: game.mentionedCities[game.mentionedCities.length - 1], // Останнє згадане місто
    };
    // Відправляємо повідомлення про неправильний хід клієнту
    io.to(socket.id).emit("turn", data);
  }

  socket.on("end turn", function (data) {
    const gameId = data.gameId;
    const city = data.city;
    const game = games[gameId];
    if (game) {
      if (!game.mentionedCities.includes(city)) {
        const lastCity = game.mentionedCities[game.mentionedCities.length - 1];
        if (
          !lastCity ||
          city.charAt(0).toUpperCase() === lastCity.slice(-1).toUpperCase()
        ) {
          // Перевіряємо, чи нове місто починається на останню букву попереднього міста
          connection.query(
            "SELECT * FROM `city` WHERE `city`.`name` = ?",
            [city],
            (err, results, fields) => {
              if (err) throw err;
              if (results.length > 0) {
                game.mentionedCities.push(city);
                game.turn++; // Оновлюємо лічильник ходу
                if (game.turn >= game.players.length) {
                  game.turn = 0;
                }
                NextTurn(game);
              } else {
                ErrorTurn(game, 1);
              }
            }
          );
        } else {
          ErrorTurn(game, 3);
        }
      } else {
        ErrorTurn(game, 2);
      }
    } else {
      // Якщо гра з даним gameId не існує, відправте відповідне повідомлення про помилку
      socket.emit("game not found");
    }
  });

  socket.on("lose", function (data) {
    const gameId = data.gameId;
    const game = games[gameId];
    const playerIdToRemove = game.players[game.turn]; // Отримати playerId гравця, який програв
    io.emit("game lose");
    // Видаляємо гравця зі списку гравців
    game.players = game.players.filter(
      (playerId) => playerId !== playerIdToRemove
    );

    // Перевіряємо, чи залишився лише один гравець
    if (game.players.length === 1) {
      // Виголошуємо переможця
      const winnerId = game.players[0];
      io.to(winnerId).emit("game won");
      // Очищаємо гру
      delete games[gameId];
    } else {
      // Оновлюємо лічильник ходу
      game.turn++;
      if (game.turn >= game.players.length) {
        game.turn = 0;
      }
      // Передаємо хід наступному гравцеві
      NextTurn(game);
    }
  });
});

http.listen(3000, function () {
  console.log("listening on *:3000");
});
