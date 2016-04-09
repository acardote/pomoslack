var http = require('http');
var redis = require('redis');
var qs = require('querystring');
var Slack = require('slack-node');
var RedisNotifier = require('redis-notifier');


const PORT = 8080;
const defaultNotifTime = 5*60; //seconds

// Setup redis connection
rClient = redis.createClient();
rClient.on("error", function (err) {
    console.log("Error " + err);
});

// Setup redis notifier
var eventNotifier = new RedisNotifier(redis, {
    redis: {
        host: '127.0.0.1'
        , port: 6379
    }
    , expired: true
    , evicted: true
    , logLevel: 'DEBUG' //Defaults To INFO 
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
                    rClient.set('@' + postData.user_name, '', redis.print);
                    rClient.expire('@' + postData.user_name, defaultNotifTime, redis.print); // Testing. 50x60
                    rClient.set('shadow_@' + postData.user_name, '', redis.print); // Using a shadow key to keep access to value when key expires

                    response.writeHead(200, {
                        'Content-Type': 'text/html'
                    });
                    response.end('Your pomodoro has just started, I\'ve just disabled your notifications for ' + defaultNotifTime/60 + ' minutes. See you soon!');

                    // Use slack API to set user's notifications off for x amount of time
                    console.log ('Snoozing ' + postData.user_name);
                    slack = new Slack(postData.token);
                    slack.api('dnd.setSnooze', {
                        num_minutes: defaultNotifTime/60
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

                    // if the key exists, the user is in a pomodoro
                    if (reply == 1) {
                        rClient.ttl(postData.text, function (err, time) {
                            response.writeHead(200, {
                                'Content-Type': 'text/html'
                            });
                            response.end(postData.text + ' is in a pomodoro until ' + Number(time / 60).toFixed(0) + ' minutes from now.');
                            console.log(postData.text + ' is in a pomodoro until ' + Number(time / 60).toFixed(0) + ' minutes from now.');
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
                rClient.del('@' + postData.user_name, '', redis.print);
                rClient.del('shadow_@' + postData.user_name, '', redis.print);

                // Cancel notif snooze
                slack.api('dnd.endSnooze', {
                    user_name: postData.user_name
                }, function (err, response) {
                    console.log(response);
                });

                // Reply
                response.end('I\'ve cancelled your pomodoro. Hope it\'s for a good reason!');
                console.log('I\'ve cancelled your pomodoro. Hope it\'s for a good reason!');

            } else if (postData.command === '/pomosync') {

                console.log('Syncing with: '+ postData.text);    
                // Check if the key exists
                rClient.exists(postData.text, function (err, reply) {
                    if (err) {
                        return console.error("error response - " + err);
                    }

                    // if the key exists, the user is in a pomodoro
                    if (reply == 1) {
                        rClient.ttl(postData.text, function (err, time) {
                            response.writeHead(200, {
                                'Content-Type': 'text/html'
                            });
                            // Get other user's synced people list
                            rClient.get(postData.text, function(err, reply){
                                var syncedList = reply;
                                // Add me to the other user's synced list
                                console.log('Adding ' + postData.user_name + ' to ' + postData.text + ' list');
                                rClient.set(postData.text, syncedList + ' ' + postData.user_name, redis.print);
                                rClient.set('shadow_' + postData.text, syncedList + ' ' + postData.user_name, redis.print); // Using a shadow key to keep access to value when key expires
                                rClient.expire(postData.text, time, redis.print);

                                // Set my expiration date
                                rClient.expire(postData.user_name, time, redis.print);

                                // Use slack API to set user's notifications off for x amount of time
                                slack.api('dnd.setSnooze', {
                                    num_minutes: time
                                    , user_name: postData.user_name
                                }, function (err, response) {
                                    console.log(response);
                                });

                                // Send response
                                response.end('You should be able to talk with ' + postData.text + ' in ' + Number(time / 60).toFixed(0) + ' minutes. I\'ve synced your pomodoros');
                            });

                            
                        });

                    } else {
                        response.writeHead(200, {
                            'Content-Type': 'text/html'
                        });
                        response.end(postData.text + ' is not in a pomodoro.');

                        console.log(postData.text + ' is not in a pomodoro');
                    }
                });
            } else {
                response.writeHead(405, 'Method Not Supported', {
                    'Content-Type': 'text/html'
                });
                return response.end('<!doctype html><html><head><title>405</title></head><body>405: Method Not Supported</body></html>');
            }
        });
    }
}



// Handler for key expiration
function handleExpire(key) {
    // Get info from shadow key
    shadowKey = 'shadow_' + key;
    rClient.get(shadowKey, function (err, reply) {
        console.log('GET ' + shadowKey + ' reply: ' + reply);
        var value = reply;
        rClient.del(shadowKey, '', redis.print);

        // Send notification to user
        slack.api('chat.postMessage', {
            username: 'Pomoslack'
            , channel: key
            , as_user: false
            , text: 'Your pomodoro just ended! ' + value + ' wanted to talk to you.'
        }, function (err, response) {
            console.log(response);
        });

        // Send notification to synced users and cancel their pomodoros
        var users = value.split(' ');
        users.forEach(function (err, user) {
            // Cancel synced user's pomodoro
            console.log('Cancelling ' + user + ' pomodoro');
            rClient.del('@' + user, '', redis.print);
            rClient.del('shadow_@' + user, '', redis.print);

            // Cancel notif snooze
            console.log('Ending ' + user + ' snooze');
            slack.api('dnd.endSnooze', {
                user_name: user
            }, function (err, response) {
                console.log(response);
            });

            // Send notification to user
            console.log('Sending notification to ' + user);
            slack.api('chat.postMessage', {
                username: 'Pomoslack'
                , channel: user
                , as_user: false
                , text: key + 'pomodoro just ended. I\'ve cancelled your pomodoro as you asked me, go talk to him!'
            }, function (err, response) {
                console.log(response);
            });
        })
    })




}
// Listen to redis events
eventNotifier.on('message', function (pattern, channelPattern, emittedKey) {
    var channel = this.parseMessageChannel(channelPattern);
    switch (channel.key) {
    case 'expired':
        handleExpire(emittedKey);
        break;
        logger.debug("Unrecognized Channel Type:" + channel.type);
    }
});


// Create a server
var server = http.createServer(handleRequest);

// Start the server
server.listen(PORT, function () {
    console.log("Server listening on: http://localhost:%s", PORT);
});