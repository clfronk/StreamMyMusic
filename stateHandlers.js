'use strict';

var AWS = require("aws-sdk");
var Alexa = require('alexa-sdk');
var audioData = require('./audioAssets');
var constants = require('./constants');

var dynamoDB = new AWS.DynamoDB();
var docClient = new AWS.DynamoDB.DocumentClient();

var tempGlobal = null;

function isAlbumSearched(element)
{
    return element === "album";
}

function isArtistSearched(element)
{
    return element === "artist";
}

function isTrackSearched(element)
{
    return element === "track";
}

function preprocessName(origName)
{
    var processedName = "";
    origName = origName.toLowerCase();
    
    if (origName.match(/^the\s/))
    {
        origName = origName.substring(3);
    }
    
    for ( var i = 0; i < origName.length; i++ )
    {
        var charStr = origName.charAt(i);
        var pattern = /[a-z0-9]/;
        if( charStr.match(pattern) !== null )
        {
            processedName = processedName.concat(origName.charAt(i));            
        }
    }
    
    if(processedName.length === 0)
    {
        processedName = "Unknown";
    }
    
    return processedName;
}

function getPlaylistForTrackIntent(intent)
{
    intent = this.event.request.intent;
    var track = intent.slots['Track'].value;
    var artist = intent.slots['Artist'].value;
    
    var tableName = process.env.DYNAMODB_MUSIC_TRACK_TABLE;
    var params = null;
    if (artist !== null && artist !== undefined && artist !== "")
    {
        params = {
            TableName: tableName,
            KeyConditionExpression: "title = :track and artist = :artist",
            ExpressionAttributeValues: {
                ":track": preprocessName(track),
                ":artist": preprocessName(artist)
            }
        };
    }
    else
    {
        params = {
            TableName: tableName,
            KeyConditionExpression: "title = :track",
            ExpressionAttributeValues: {
                ":track": preprocessName(track)
            }
        };
    }
    
    console.log("Querying for track " + track + "\n");
    
    tempGlobal = this;
    docClient.query(params, function(err, data) {
        
        if(err)
        {
            console.log(err);
        }
        else
        {
            if (data !== null && data.Items !== null)
            {
                tempGlobal.attributes['activePlaylist'] = [];
                for(var i = 0; i < data.Items.length; ++i)
                {
                    var item = data.Items[i];
                    tempGlobal.attributes['activePlaylist'].push( {
                        "title": item.ui_title + " by " + item.ui_artist,
                        "url": item.url
                    } );
                }
                
                // Initialize Attributes if undefined.
                tempGlobal.attributes['playOrder'] = Array.apply(null, {length: tempGlobal.attributes['activePlaylist'].length}).map(Number.call, Number);
                tempGlobal.attributes['index'] = 0;
                tempGlobal.attributes['offsetInMilliseconds'] = 0;
                tempGlobal.attributes['loop'] = true;
                tempGlobal.attributes['shuffle'] = false;
                tempGlobal.attributes['playbackIndexChanged'] = true;

                
                //  Change state to START_MODE
                tempGlobal.handler.state = constants.states.START_MODE;
                
                if (tempGlobal.attributes['activePlaylist'].length == 0)
                {
                    var searchedAlbums = false;
                    var searchedArtists = false;
                    if (tempGlobal.attributes['searchedTables'])
                    {
                        tempGlobal.attributes['searchedTables'].push("track");
                        searchedAlbums = tempGlobal.attributes['searchedTables'].find(isAlbumSearched) !== undefined;
                        searchedArtists = tempGlobal.attributes['searchedTables'].find(isArtistSearched) !== undefined; 
                    }
                    else
                    {
                        tempGlobal.attributes['searchedTables'] = ["track"];
                    }
                                                          
                    if (!searchedAlbums)
                    {
                        intent.name = "PlayAlbum";
                        intent.slots['Album'] = { name: "Album", value: track };
                        getPlaylistForAlbumIntent.call(tempGlobal, intent);
                    }
                    else if (!searchedArtists && artist === "")
                    {
                        intent.name = "PlayArtist";
                        intent.slots['Artist'] = { name: "Artist", value: track };
                        getPlaylistForArtistIntent.call(tempGlobal, intent);
                    }
                    else
                    {
                        var message = "Unable to find " + track;
                        if(artist != null && artist !== undefined && artist !== "")
                        {
                            message += " by " + artist;
                        }

                        tempGlobal.attributes['searchedTables'] = [];
                        
                        tempGlobal.response.speak(message);
                        tempGlobal.emit(':responseReady');
                        
                        tempGlobal.emit(':saveState', true);
                    }
                }
                else
                {
                    tempGlobal.attributes['searchedTables'] = [];
                    controller.play.call(tempGlobal);
                    
                    tempGlobal.emit(':saveState', true);
                }
            }
        }
    });
}

function compareAristTrackItem(a, b)
{
    if( a.ui_album === b.ui_album )
    {
        var trackNum1 = parseInt(a.trackNumber);
        var trackNum2 = parseInt(b.trackNumber);
        
        if( trackNum1 < trackNum2 )
        {
            return -1;
        }
        else
        {
            return 1;
        }
    }
    else
    {
        if( a.ui_album < b.ui_album )
        {
            return -1;
        }
        else
        {
            return 1;
        }
    }
}

function getPlaylistForArtistIntent(intent)
{
    intent = this.event.request.intent;
    var artist = intent.slots['Artist'].value;
    
    var tableName = process.env.DYNAMODB_MUSIC_ARTIST_TABLE;
    var params = null;
    console.log(artist);
    if (artist !== null && artist !== undefined && artist !== "")
    {
        params = {
            TableName: tableName,
            KeyConditionExpression: "artist = :artist",
            ExpressionAttributeValues: {
                ":artist": preprocessName(artist)
            }
        };
    }
    
    tempGlobal = this;
    docClient.query(params, function(err, data) {
        
        if(err)
        {
            console.log(err);
        }
        else
        {
            if (data !== null && data.Items !== null)
            {
                tempGlobal.attributes['activePlaylist'] = [];
                
                var sortedItems = data.Items;
                sortedItems.sort(compareAristTrackItem);
                for(var i = 0; i < sortedItems.length; ++i)
                {
                    var item = sortedItems[i];
                    tempGlobal.attributes['activePlaylist'].push( {
                        "title": item.ui_title + " by " + item.ui_artist,
                        "url": item.url
                    } );
                }
                
                // Initialize Attributes if undefined.
                tempGlobal.attributes['playOrder'] = Array.apply(null, {length: tempGlobal.attributes['activePlaylist'].length}).map(Number.call, Number);
                tempGlobal.attributes['index'] = 0;
                tempGlobal.attributes['offsetInMilliseconds'] = 0;
                tempGlobal.attributes['loop'] = true;
                tempGlobal.attributes['shuffle'] = false;
                tempGlobal.attributes['playbackIndexChanged'] = true;
                
                //  Change state to START_MODE
                tempGlobal.handler.state = constants.states.START_MODE;
                
                if (tempGlobal.attributes['activePlaylist'].length == 0)
                {
                    var searchedAlbums = false;
                    var searchedTracks = false;
                    if (tempGlobal.attributes['searchedTables'])
                    {
                        tempGlobal.attributes['searchedTables'].push("artist");
                        searchedAlbums = tempGlobal.attributes['searchedTables'].find(isAlbumSearched) !== undefined;
                        searchedTracks = tempGlobal.attributes['searchedTables'].find(isTrackSearched) !== undefined; 
                    }
                    else
                    {
                        tempGlobal.attributes['searchedTables'] = ["artist"];
                    }
                                       
                    intent.slots['Artist'].value = "";
                    
                    if (!searchedAlbums)
                    {
                        intent.name = "PlayAlbum";
                        intent.slots['Album'] = { name: "Album", value: artist };
                        getPlaylistForAlbumIntent.call(tempGlobal, intent);
                    }
                    else if (!searchedTracks)
                    {
                        intent.name = "PlayTrack";
                        intent.slots['Track'] = { name: "Track", value: artist };
                        getPlaylistForTrackIntent.call(tempGlobal, intent);
                    }
                    else
                    {
                        var message = "Unable to find " + artist;
                        
                        tempGlobal.attributes['searchedTables'] = [];
                        
                        tempGlobal.response.speak(message);
                        tempGlobal.emit(':responseReady');
                        
                        tempGlobal.emit(':saveState', true);
                    }
                }
                else
                {
                    tempGlobal.attributes['searchedTables'] = [];
                    controller.play.call(tempGlobal);
                    tempGlobal.emit(':saveState', true);                    
                }
            }
        }
    });    
}

function getPlaylistForAlbumIntent(intent)
{
    intent = this.event.request.intent;
    var album = intent.slots['Album'].value;
    var artist = intent.slots['Artist'].value;
    
    var tableName = process.env.DYNAMODB_MUSIC_ALBUM_TABLE;
    var params = null;
    if (artist !== null && artist !== undefined && artist !== "")
    {
        params = {
            TableName: tableName,
            KeyConditionExpression: "album = :album and artist = :artist",
            ExpressionAttributeValues: {
                ":album": preprocessName(album),
                ":artist": preprocessName(artist)
            }
        };
    }
    else
    {
        params = {
            TableName: tableName,
            KeyConditionExpression: "album = :album",
            ExpressionAttributeValues: {
                ":album": preprocessName(album)
            }
        };
    }
    
    console.log("Querying for album " + album + "\n");
    
    tempGlobal = this;
    docClient.query(params, function(err, data) {
        
        if(err)
        {
            console.log(err);
        }
        else
        {
            if (data !== null && data.Items !== null)
            {
                tempGlobal.attributes['activePlaylist'] = [];
                for(var i = 0; i < data.Items.length; ++i)
                {
                    var item = data.Items[i];
                    
                    var tracks = item.tracks;
                    tracks.sort(compareAristTrackItem);
                    for( var j = 0; j < tracks.length; ++j )
                    {                    
                        tempGlobal.attributes['activePlaylist'].push( {
                            "title": tracks[j].ui_title + " by " + item.ui_artist,
                            "url": tracks[j].url
                        } );
                    }
                }
                
                // Initialize Attributes if undefined.
                tempGlobal.attributes['playOrder'] = Array.apply(null, {length: tempGlobal.attributes['activePlaylist'].length}).map(Number.call, Number);
                tempGlobal.attributes['index'] = 0;
                tempGlobal.attributes['offsetInMilliseconds'] = 0;
                tempGlobal.attributes['loop'] = true;
                tempGlobal.attributes['shuffle'] = false;
                tempGlobal.attributes['playbackIndexChanged'] = true;
                
                //  Change state to START_MODE
                tempGlobal.handler.state = constants.states.START_MODE;
                
                if (tempGlobal.attributes['activePlaylist'].length == 0)
                {
                    var searchedArtists = false;
                    var searchedTracks = false;
                    if (tempGlobal.attributes['searchedTables'])
                    {
                        tempGlobal.attributes['searchedTables'].push("album");
                        searchedArtists = tempGlobal.attributes['searchedTables'].find(isArtistSearched) !== undefined;
                        searchedTracks = tempGlobal.attributes['searchedTables'].find(isTrackSearched) !== undefined; 
                    }
                    else
                    {
                        tempGlobal.attributes['searchedTables'] = ["album"];
                    }
                                       
                    if (!searchedArtists)
                    {
                        intent.name = "PlayArtist";
                        intent.slots['Artist'] = { name: "Artist", value: album };
                        getPlaylistForArtistIntent.call(tempGlobal, intent);
                    }
                    else if (!searchedTracks && artist === "")
                    {
                        intent.name = "PlayTrack";
                        intent.slots['Track'] = { name: "Track", value: album };
                        getPlaylistForTrackIntent.call(tempGlobal, intent);
                    }
                    else
                    {                    
                        var message = "Unable to find " + album;
                        if(artist != null && artist !== undefined && artist !== "")
                        {
                            message += " by " + artist;
                        }
                        
                        tempGlobal.attributes['searchedTables'] = [];                        
                        tempGlobal.response.speak(message);
                        tempGlobal.emit(':responseReady');
                        tempGlobal.emit(':saveState', true);                        
                    }
                }
                else
                {
                    tempGlobal.attributes['searchedTables'] = [];
                    controller.play.call(tempGlobal);
                    tempGlobal.emit(':saveState', true);                    
                }
            }
        }
    });
}


var stateHandlers = {
    startModeIntentHandlers : Alexa.CreateStateHandler(constants.states.START_MODE, {
        /*
         *  All Intent Handlers for state : START_MODE
         */
        'LaunchRequest' : function () {
            this.attributes['activePlaylist'] = [];
            // Initialize Attributes
            this.attributes['playOrder'] = Array.apply(null, {length: this.attributes['activePlaylist'].length}).map(Number.call, Number);
            this.attributes['index'] = 0;
            this.attributes['offsetInMilliseconds'] = 0;
            this.attributes['loop'] = true;
            this.attributes['shuffle'] = false;
            this.attributes['playbackIndexChanged'] = true;
            //  Change state to START_MODE
            this.handler.state = constants.states.START_MODE;

            var message = 'Welcome to Stream My Music. You can say, play artist, play album, or play song to begin.';
            var reprompt = 'You can say, play artist, play album, or play song to begin.';

            this.response.speak(message).listen(reprompt);
            this.emit(':responseReady');
        },
        'PlayTrack' : function () {
            getPlaylistForTrackIntent.call(this);
        },
        'PlayAlbum' : function () {
            getPlaylistForAlbumIntent.call(this);
        },
        'PlayArtist' : function () {
            getPlaylistForArtistIntent.call(this);
        },        
        'AMAZON.HelpIntent' : function () {
            var message = 'Welcome to the Stream My Music. You can say, play artist, play album, or play song to begin.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        },
        'AMAZON.StopIntent' : function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'AMAZON.CancelIntent' : function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest' : function () {
            // No session ended logic
        },
        'Unhandled' : function () {
            var message = 'Sorry, I could not understand. Please say, You can say, play artist, play album, or play song to begin.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    }),
    playModeIntentHandlers : Alexa.CreateStateHandler(constants.states.PLAY_MODE, {
        /*
         *  All Intent Handlers for state : PLAY_MODE
         */
        'LaunchRequest' : function () {
            /*
             *  Session resumed in PLAY_MODE STATE.
             *  If playback had finished during last session :
             *      Give welcome message.
             *      Change state to START_STATE to restrict user inputs.
             *  Else :
             *      Ask user if he/she wants to resume from last position.
             *      Change state to RESUME_DECISION_MODE
             */
            var message;
            var reprompt;
            if (this.attributes['playbackFinished']) {
                this.handler.state = constants.states.START_MODE;
                message = 'Welcome to Stream My Music. You can say, play artist, play album, or play song to begin.';
                reprompt = 'You can say, play artist, play album, or play song to begin.';
            } else {
                this.handler.state = constants.states.RESUME_DECISION_MODE;
                message = 'You were listening to ' + this.attributes['activePlaylist'][this.attributes['playOrder'][this.attributes['index']]].title +
                    ' Would you like to resume?';
                reprompt = 'You can say yes to resume or no to play from the top.';
            }

            this.response.speak(message).listen(reprompt);
            this.emit(':responseReady');
        },
        'PlayTrack' : function () { getPlaylistForTrackIntent.call(this) },
        'PlayArtist' : function () { getPlaylistForArtistIntent.call(this) },
        'PlayAlbum' : function () { getPlaylistForAlbumIntent.call(this) },
        'CurrentlyPlaying': function() {
            if (this.attributes['index'] < this.attributes.activePlaylist.length)
            {
                var message = 'You are listening to ' + this.attributes['activePlaylist'][this.attributes['playOrder'][this.attributes['index']]].title;
                this.response.speak(message);
                this.emit(':responseReady');
            }
        },
        'AMAZON.NextIntent' : function () { controller.playNext.call(this) },
        'AMAZON.PreviousIntent' : function () { controller.playPrevious.call(this) },
        'AMAZON.PauseIntent' : function () { controller.stop.call(this) },
        'AMAZON.StopIntent' : function () { controller.stop.call(this) },
        'AMAZON.CancelIntent' : function () { controller.stop.call(this) },
        'AMAZON.ResumeIntent' : function () { controller.play.call(this) },
        'AMAZON.LoopOnIntent' : function () { controller.loopOn.call(this) },
        'AMAZON.LoopOffIntent' : function () { controller.loopOff.call(this) },
        'AMAZON.ShuffleOnIntent' : function () { controller.shuffleOn.call(this) },
        'AMAZON.ShuffleOffIntent' : function () { controller.shuffleOff.call(this) },
        'AMAZON.StartOverIntent' : function () { controller.startOver.call(this) },
        'AMAZON.HelpIntent' : function () {
            // This will called while audio is playing and a user says "ask <invocation_name> for help"
            var message = 'You are listening to Stream My Music. You can say, Next or Previous to navigate through the playlist. ' +
                'At any time, you can say Pause to pause the audio and Resume to resume.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest' : function () {
            // No session ended logic
        },
        'Unhandled' : function () {
            var message = 'Sorry, I could not understand. You can say, Next or Previous to navigate through the playlist.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    }),
    remoteControllerHandlers : Alexa.CreateStateHandler(constants.states.PLAY_MODE, {
        /*
         *  All Requests are received using a Remote Control. Calling corresponding handlers for each of them.
         */
        'PlayCommandIssued' : function () { controller.play.call(this) },
        'PauseCommandIssued' : function () { controller.stop.call(this) },
        'NextCommandIssued' : function () { controller.playNext.call(this) },
        'PreviousCommandIssued' : function () { controller.playPrevious.call(this) }
    }),
    resumeDecisionModeIntentHandlers : Alexa.CreateStateHandler(constants.states.RESUME_DECISION_MODE, {
        /*
         *  All Intent Handlers for state : RESUME_DECISION_MODE
         */
        'LaunchRequest' : function () {
            var message = 'You were listening to ' + this.attributes['activePlaylist'][this.attributes['playOrder'][this.attributes['index']]].title +
                ' Would you like to resume?';
            var reprompt = 'You can say yes to resume or no to play from the top.';
            this.response.speak(message).listen(reprompt);
            this.emit(':responseReady');
        },
        'PlayTrack' : function () { getPlaylistForTrackIntent.call(this) },
        'PlayArtist' : function () { getPlaylistForArtistIntent.call(this) },
        'PlayAlbum' : function () { getPlaylistForAlbumIntent.call(this) },
        'AMAZON.YesIntent' : function () { controller.play.call(this) },
        'AMAZON.NoIntent' : function () { controller.reset.call(this) },
        'AMAZON.HelpIntent' : function () {
            var message = 'You were listening to ' + this.attributes['activePlaylist'][this.attributes['index']].title +
                ' Would you like to resume?';
            var reprompt = 'You can say yes to resume or no to play from the top.';
            this.response.speak(message).listen(reprompt);
            this.emit(':responseReady');
        },
        'AMAZON.StopIntent' : function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'AMAZON.CancelIntent' : function () {
            var message = 'Good bye.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        'SessionEndedRequest' : function () {
            // No session ended logic
        },
        'Unhandled' : function () {
            var message = 'Sorry, this is not a valid command. Please say help to hear what you can say.';
            this.response.speak(message).listen(message);
            this.emit(':responseReady');
        }
    })
};

module.exports = stateHandlers;

var controller = function () {
    return {
        play: function () {
            /*
             *  Using the function to begin playing audio when:
             *      Play Audio intent invoked.
             *      Resuming audio when stopped/paused.
             *      Next/Previous commands issued.
             */
            this.handler.state = constants.states.PLAY_MODE;

            if (this.attributes['playbackFinished']) {
                // Reset to top of the playlist when reached end.
                this.attributes['index'] = 0;
                this.attributes['offsetInMilliseconds'] = 0;
                this.attributes['playbackIndexChanged'] = true;
                this.attributes['playbackFinished'] = false;
            }

            var token = String(this.attributes['playOrder'][this.attributes['index']]);
            var playBehavior = 'REPLACE_ALL';
            var podcast = this.attributes['activePlaylist'][this.attributes['playOrder'][this.attributes['index']]];
            var offsetInMilliseconds = this.attributes['offsetInMilliseconds'];
            // Since play behavior is REPLACE_ALL, enqueuedToken attribute need to be set to null.
            this.attributes['enqueuedToken'] = null;

            if (canThrowCard.call(this)) {
                var cardTitle = 'Playing ' + podcast.title;
                var cardContent = 'Playing ' + podcast.title;
                this.response.cardRenderer(cardTitle, cardContent, null);
            }

            this.response.audioPlayerPlay(playBehavior, podcast.url, token, null, offsetInMilliseconds);
            this.emit(':responseReady');
        },
        stop: function () {
            /*
             *  Issuing AudioPlayer.Stop directive to stop the audio.
             *  Attributes already stored when AudioPlayer.Stopped request received.
             */
            this.response.audioPlayerStop();
            this.emit(':responseReady');
        },
        playNext: function () {
            /*
             *  Called when AMAZON.NextIntent or PlaybackController.NextCommandIssued is invoked.
             *  Index is computed using token stored when AudioPlayer.PlaybackStopped command is received.
             *  If reached at the end of the playlist, choose behavior based on "loop" flag.
             */
            var index = this.attributes['index'];
            index += 1;
            // Check for last audio file.
            if (index === this.attributes['activePlaylist'].length) {
                if (this.attributes['loop']) {
                    index = 0;
                } else {
                    // Reached at the end. Thus reset state to start mode and stop playing.
                    this.handler.state = constants.states.START_MODE;

                    var message = 'You have reached at the end of the playlist.';
                    this.response.speak(message).audioPlayerStop();
                    return this.emit(':responseReady');
                }
            }
            // Set values to attributes.
            this.attributes['index'] = index;
            this.attributes['offsetInMilliseconds'] = 0;
            this.attributes['playbackIndexChanged'] = true;

            controller.play.call(this);
        },
        playPrevious: function () {
            /*
             *  Called when AMAZON.PreviousIntent or PlaybackController.PreviousCommandIssued is invoked.
             *  Index is computed using token stored when AudioPlayer.PlaybackStopped command is received.
             *  If reached at the end of the playlist, choose behavior based on "loop" flag.
             */
            var index = this.attributes['index'];
            index -= 1;
            // Check for last audio file.
            if (index === -1) {
                if (this.attributes['loop']) {
                    index = this.attributes['activePlaylist'].length - 1;
                } else {
                    // Reached at the end. Thus reset state to start mode and stop playing.
                    this.handler.state = constants.states.START_MODE;

                    var message = 'You have reached at the start of the playlist.';
                    this.response.speak(message).audioPlayerStop();
                    return this.emit(':responseReady');
                }
            }
            // Set values to attributes.
            this.attributes['index'] = index;
            this.attributes['offsetInMilliseconds'] = 0;
            this.attributes['playbackIndexChanged'] = true;

            controller.play.call(this);
        },
        loopOn: function () {
            // Turn on loop play.
            this.attributes['loop'] = true;
            var message = 'Loop turned on.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        loopOff: function () {
            // Turn off looping
            this.attributes['loop'] = false;
            var message = 'Loop turned off.';
            this.response.speak(message);
            this.emit(':responseReady');
        },
        shuffleOn: function () {
            // Turn on shuffle play.
            this.attributes['shuffle'] = true;
            shuffleOrder((newOrder) => {
                // Play order have been shuffled. Re-initializing indices and playing first song in shuffled order.
                this.attributes['playOrder'] = newOrder;
                this.attributes['index'] = 0;
                this.attributes['offsetInMilliseconds'] = 0;
                this.attributes['playbackIndexChanged'] = true;
                controller.play.call(this);
            });
        },
        shuffleOff: function () {
            // Turn off shuffle play. 
            if (this.attributes['shuffle']) {
                this.attributes['shuffle'] = false;
                // Although changing index, no change in audio file being played as the change is to account for reordering playOrder
                this.attributes['index'] = this.attributes['playOrder'][this.attributes['index']];
                this.attributes['playOrder'] = Array.apply(null, {length: this.attributes['activePlaylist'].length}).map(Number.call, Number);
            }
            controller.play.call(this);
        },
        startOver: function () {
            // Start over the current audio file.
            this.attributes['offsetInMilliseconds'] = 0;
            controller.play.call(this);
        },
        reset: function () {
            // Reset to top of the playlist.
            this.attributes['index'] = 0;
            this.attributes['offsetInMilliseconds'] = 0;
            this.attributes['playbackIndexChanged'] = true;
            this.attributes['activePlaylist'] = [];
            this.emit(':saveState', true);
        }
    }
}();

function canThrowCard() {
    /*
     * To determine when can a card should be inserted in the response.
     * In response to a PlaybackController Request (remote control events) we cannot issue a card,
     * Thus adding restriction of request type being "IntentRequest".
     */
    if (this.event.request.type === 'IntentRequest' && this.attributes['playbackIndexChanged']) {
        this.attributes['playbackIndexChanged'] = false;
        return true;
    } else {
        return false;
    }
}

function shuffleOrder(callback) {
    // Algorithm : Fisher-Yates shuffle
    var array = Array.apply(null, {length: this.attributes['activePlaylist'].length}).map(Number.call, Number);
    var currentIndex = array.length;
    var temp, randomIndex;

    while (currentIndex >= 1) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
        temp = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temp;
    }
    callback(array);
}
