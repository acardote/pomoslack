var http = require('http');
var redis = require('redis');
var qs = require('querystring');
var Slack = require('slack-node');


const PORT = 8080;


// Setup redis connection
rClient = redis.createClient();
rClient.on("error", function (err) {
    console.log("Error " + err);
});

// Setup slack api connection
apiToken = "---API Token---";
slack = new Slack(apiToken);

// Handle requests and send response
function handleRequest(request, response) {
    if (request.method === "POST") {
        var requestBody = '';
        request.on('data', function (data) {
            requestBody += data;
            if (requestBody.length > 1e7) {
                response.writeHead(413, 'Request Entity Too Large', {
                    'Content-Type': 'text/html'
                });
                response.end('<!doctype html><html><head><title>413</title></head><body>413: Request Entity Too Large</body></html>');
            }
        });
        request.on('end', function () {
            var postData = qs.parse(requestBody);
            console.log(postData);

            // TODO: Verify slack token

            // Start pomodoro with default timer
            if (postData.command === '/pomostart') {
                if (postData.text === '') {
                    rClient.set('@' + postData.user_name, 'inPomo', redis.print);
                    rClient.expire('@' + postData.user_name, 50*60, redis.print);

                    response.writeHead(200, {
                        'Content-Type': 'text/html'
                    });
                    response.end('Your pomodoro has just started, I\'ve just disabled your notifications for 50 minutes. See you soon!');

                    // Use slack API to set user's notifications off for x amount of time
                    slack.api('dnd.setSnooze', {
                        num_minutes: '50'
                        , user_name: postData.user_name
                    }, function (err, response) {
                        console.log(response);
                    });
                }
                // Start pomodoro with custom timer
                else {
                    // TODO
                }
            } else if (postData.command === '/pomocheck') {
                // Check if the key exists
                rClient.exists(postData.text, function (err, reply) {
                    if (err) {
                        return console.error("error response - " + err);
                    }

                    // if the key exists, the user is not in a pomodoro
                    if (reply == 1) {
                        rClient.ttl(postData.text, function (err, time) {
                            response.writeHead(200, {
                                'Content-Type': 'text/html'
                            });
                            response.end(postData.text + ' is in a pomodoro until ' + Number(time/60).toFixed(0) + ' minutes from now.');
                            console.log(postData.text + ' is in a pomodoro until ' + Number(time/60).toFixed(0) + ' minutes from now.');
                        })

                    } else {
                        response.writeHead(200, {
                            'Content-Type': 'text/html'
                        });
                        response.end(postData.text + ' is not in a pomodoro.');

                        console.log(postData.text + ' is not in a pomodoro');
                    }
                });

            } else if (postData.command === '/pomocancel') {
                // Delete the key from the database
                rClient.del('@' + postData.user_name, 'inPomo', redis.print);
                
                // Cancel notif snooze
                slack.api('dnd.endSnooze', {
                        user_name: postData.user_name
                    }, function (err, response) {
                        console.log(response);
                    });
                
                // Reply
                response.end('I\'ve cancelled your pomodoro. Hope it\'s for a good reason!');
                console.log('I\'ve cancelled your pomodoro. Hope it\'s for a good reason!');
            }
        });
    } else {
        response.writeHead(405, 'Method Not Supported', {
            'Content-Type': 'text/html'
        });
        return response.end('<!doctype html><html><head><title>405</title></head><body>405: Method Not Supported</body></html>');
    }
}

// Create a server
var server = http.createServer(handleRequest);

// Start the server
server.listen(PORT, function () {
    console.log("Server listening on: http://localhost:%s", PORT);
});