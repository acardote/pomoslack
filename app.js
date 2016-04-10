var http = require('http');
var redis = require('redis');
var qs = require('querystring');
var Slack = require('slack-node');
var RedisNotifier = require('redis-notifier');


const PORT = 8080;
const defaultNotifTime = 5 * 60; //seconds

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
                    rClient.set('pom_' + postData.team_domain + '_' + postData.user_name, '', redis.print);
                    rClient.expire('pom_' + postData.team_domain + '_' + postData.user_name, defaultNotifTime, redis.print); // Testing. 50x60
                    rClient.set('shadow_pom_' + postData.team_domain + '_' + postData.user_name, '', redis.print); // Using a shadow key to keep access to value when key expires

                    response.writeHead(200, {
                        'Content-Type': 'text/html'
                    });


                    // Use slack API to set user's notifications off for x amount of time
                    rClient.get('tok_' + postData.team_domain + '_' + postData.user_name, function (err, reply) {
                        if (err) {
                            return console.error("error response - " + err);
                        }
                        if (reply != null) {
                            console.log('Snoozing ' + postData.user_name);
                            slack = new Slack(reply);
                            slack.api('dnd.setSnooze', {
                                num_minutes: defaultNotifTime / 60
                                , user_name: postData.user_name
                            }, function (err, response) {
                                console.log(response);
                            });
                            response.end('Your pomodoro has just started, I\'ve disabled your notifications for ' + defaultNotifTime / 60 + ' minutes. See you soon!');

                        } else {
                            response.end('You have not setup pomoslack yet, so I could not disable your notifications autmatically. See /pomoslack help');
                        }
                    })

                }
                // Start pomodoro with custom timer
                else {
                    // TODO
                }
            } else if (postData.command === '/pomocheck') {
                // Check if the key exists
                rClient.exists('pom_' + postData.team_domain + '_' + postData.text.substr(1), function (err, reply) {
                    if (err) {
                        return console.error("error response - " + err);
                    }

                    // if the key exists, the user is in a pomodoro
                    if (reply == 1) {
                        rClient.ttl('pom_' + postData.team_domain + '_' + postData.text.substr(1), function (err, time) {
                            response.writeHead(200, {
                                'Content-Type': 'text/html'
                            });
                            response.end(postData.text + ' will be available in ' + Number(time / 60).toFixed(0) + ' minutes.');
                            console.log(postData.text + ' will be available in ' + Number(time / 60).toFixed(0) + ' minutes.');
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
                rClient.del('pom_' + postData.team_domain + '_' + postData.user_name, '', redis.print);
                rClient.del('shadow_pom_' + postData.team_domain + '_' + postData.user_name, '', redis.print);

                // Use slack API to cancel the user's snooze
                rClient.get('tok_' + postData.team_domain + '_' + postData.user_name, function (err, reply) {
                    if (err) {
                        return console.error("error response - " + err);
                    }
                    response.writeHead(200, {
                            'Content-Type': 'text/html'
                        });
                    
                    if (reply != null) {
                        console.log('Snoozing ' + postData.user_name);
                        slack = new Slack(reply);
                        slack.api('dnd.endSnooze', function (err, resp) {
                            console.log(resp);

                            // Reply
                            response.end('I\'ve cancelled your pomodoro. Hope it\'s for a good reason!');
                            console.log('I\'ve cancelled your pomodoro. Hope it\'s for a good reason!');

                        });

                    } else {
                        response.end('You have not setup pomoslack yet, so I could not disable your notifications autmatically. See /pomoslack help');
                    }
                })

            } else if (postData.command === '/pomosync') {

                console.log('Syncing with: ' + postData.text.substr(1));
                // Check if the key exists
                rClient.exists('shadow_pom_' + postData.team_domain + '_' + postData.text.substr(1), function (err, reply) {
                    if (err) {
                        return console.error("error response - " + err);
                    }

                    // if the key exists, the user is in a pomodoro
                    if (reply == 1) {
                        rClient.ttl('pom_' + postData.team_domain + '_' + postData.text.substr(1), function (err, time) {
                            response.writeHead(200, {
                                'Content-Type': 'text/html'
                            });
                            // Get other user's synced people list
                            rClient.get(postData.text, function (err, reply) {
                                var syncedList = syncedList == null ? '' : reply;
                                // Add me to the other user's synced list
                                console.log('Adding ' + postData.user_name + ' to ' + postData.text.substr(1) + ' list');
                                rClient.set('pom_' + postData.team_domain + '_' + postData.text.substr(1), syncedList + ' ' + postData.user_name, redis.print);
                                rClient.set('shadow_pom_' + postData.team_domain + '_' + postData.text.substr(1), syncedList + ' ' + postData.user_name, redis.print); // Using a shadow key to keep access to value when key expires
                                console.log('Refreshing ' + 'pom_' + postData.team_domain + '_' + postData.text.substr(1));
                                rClient.expire('pom_' + postData.team_domain + '_' + postData.text.substr(1), time, redis.print);

                                // Set my expiration date
                                rClient.expire('pom_' + postData.team_domain + '_' + postData.user_name, time, redis.print);

                                // Use slack API to set user's notifications off for x amount of time
                                rClient.get('tok_' + postData.team_domain + '_' + postData.user_name, function (err, reply) {
                                    if (err) {
                                        return console.error("error response - " + err);
                                    }
                                    if (reply != null) {
                                        console.log('Snoozing ' + postData.user_name);
                                        slack = new Slack(reply);
                                        slack.api('dnd.setSnooze', {
                                            num_minutes: Number(time / 60).toFixed(0)
                                        }, function (err, response) {
                                            console.log(response);
                                        });
                                        
                                        // Send response
                                        response.end('You should be able to talk with ' + postData.text + ' within ' + Number(time / 60).toFixed(0) + ' minutes. I\'ve synced your pomodoros and slack notifications. See you soon!');

                                    } else {
                                        response.end('You should be able to talk with ' + postData.text + ' within ' + Number(time / 60).toFixed(0) + ' minutes. You have not setup pomoslack yet, so I could not disable your notifications autmatically. See /pomoslack help');
                                    }
                                })
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
            } else if (postData.command === '/pomoslack') {
                var pdText = postData.text.split(' ');
                switch (pdText[0]) {
                case 'setup':
                    if (pdText[1] === '') {
                        response.end('Token missing. Usage: /pomoslack setup <token>');
                        break;
                    }
                    rClient.set('tok_' + postData.team_domain + '_' + postData.user_name, pdText[1]);
                    response.end('Token stored. Thank you, enjoy pomoslack!');
                }
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
        keySplit = key.split('_');
        user_name = keySplit[2];
        team = keySplit[1];
        console.log('key: ' + key + ' user_name: ' + user_name + ' Team: ' + team);
        var value = reply;
        rClient.del(shadowKey, '', redis.print);
        
        // Use slack API to cancel the user's snooze and notify him
        rClient.get('tok_' + team + '_' + user_name, function (err, reply) {
            if (err) {
                return console.error("error response - " + err);
            }

            if (reply != null) {
                console.log('Cancelling ' + user_name);
                slack = new Slack(reply);
                slack.api('dnd.endSnooze', function (err, resp) {
                    console.log('EndSnooze: ' + resp);

                    // Send notification to user
                    if (value === "") {
                        slack.api('chat.postMessage', {
                            username: 'Pomoslack'
                            , channel: '@' + user_name
                            , as_user: false
                            , text: 'Your pomodoro just ended!'
                        }, function (err, response) {
                            console.log(response);
                        });
                    } else {
                        slack.api('chat.postMessage', {
                            username: 'Pomoslack'
                            , channel: '@' + user_name
                            , as_user: false
                            , text: 'Your pomodoro just ended! ' + value + ' wanted to talk to you.'
                        }, function (err, response) {
                            console.log(response);
                        });
                    }
                });

            } else {

                // Send notification to user
                if (value === "") {
                    slack.api('chat.postMessage', {
                        username: 'Pomoslack'
                        , channel: '@' + user_name
                        , as_user: false
                        , text: 'Your pomodoro just ended!'
                    }, function (err, response) {
                        console.log(response);
                    });
                } else {
                    slack.api('chat.postMessage', {
                        username: 'Pomoslack'
                        , channel: '@' + user_name
                        , as_user: false
                        , text: 'Your pomodoro just ended! ' + value + ' wanted to talk to you.'
                    }, function (err, response) {
                        console.log(response);
                    });
                }
            }
        })
        
        
        // Send notification to synced users and cancel their pomodoros
        var users = value.substr(1).split(' ');
        users.forEach(function (user) {
            // Cancel synced user's pomodoro
            console.log('Cancelling ' + user + ' pomodoro');
            rClient.del('pom_' + team + '_' + user, '', redis.print);
            rClient.del('shadow_pom_' + team + '_' + user, '', redis.print);

            // Cancel notif snooze
            console.log('Ending ' + user + ' snooze');
            slack.api('dnd.endSnooze', {
                user_name: user
            }, function (err, response) {
                console.log(response);
            });

            // Use slack API to cancel the user's snooze
            rClient.get('tok_' + team + '_' + user_name, function (err, reply) {
                if (err) {
                    return console.error("error response - " + err);
                }

                if (reply != null) {
                    console.log('Cancelling ' + user_name);
                    slack = new Slack(reply);
                    slack.api('dnd.endSnooze', function (err, resp) {
                        console.log('EndSnooze: ' + resp);

                        // Send notification to user
                        console.log('[A] Sending notification to ' + user);
                        slack.api('chat.postMessage', {
                            username: 'Pomoslack'
                            , channel: '@' + user
                            , as_user: false
                            , text: '@' + user_name + 'pomodoro just ended. I\'ve cancelled your pomodoro and enabled notifications as you asked me, go talk to him!'
                        }, function (err, response) {
                            console.log('[C] PostMessage: ' + response);
                        });

                    });

                } else {

                    // Send notification to user
                    console.log('[B] Sending notification to ' + user);
                    slack.api('chat.postMessage', {
                        username: 'Pomoslack'
                        , channel: '@' + user
                        , as_user: false
                        , text: '@' + user_name + ' pomodoro just ended. I\'ve cancelled your pomodoro I could not disable your notifications autmatically. See /pomoslack help'
                    }, function (err, response) {
                        console.log('[B] PostMessage: ' + response);
                    });
                    
                }
            })

            
            
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