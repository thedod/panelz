//Hello, and welcome the javascript code of Panelz, which parses structured text and turns it into graphical, interactive panels of text on a web page. We start, as is usually recommended, by closing everything in an anonymous function, declaring strict mode and defining some vars.
(function(){'use strict'; var

    // First there's the Frame, which is an existing div in the DOM that will contain the Canvas upon which we will draw the Story. We define it here, but being an existing element, we do not dare touch it till the DOM is ready.
    Frame,

    // Then there is the Story, which turns an array of script lines into indexed instructions.
    Story = {

        // Before using the story, we are expected to fill this array with the lines of the script.
        lines: [],

        // And we initialize a cache that will fill up lazily, as the lines are parsed.
        cache: [],

        // Then we can get a specific line.
        line: function(idx){

            // We try to use the cache,
            if('undefined' !== typeof this.cache[idx]){
                return this.cache[idx];
            // then we try the unparsed text.
            }else if('undefined' !== typeof this.lines[idx]){
                // Not forgetting to cache the newly parsed line.
                return (this.cache[idx] = this.parse(this.lines[idx]));
            }

            // Having failed, we return a stop command, which means the Story is infinitely padded with stop commands on both sides.
            return;
        },

        // And here we hide the actual parser, which involves regular expressions and is not for the weak of heart or gentle of palate.
        parse: function(l){

            // First of all, we test for a line that has nothing but white-spaces, which separates blocks of commands.
            var m = l.match(/^\s*$/);
            if(m !== null){
                return;
            }

            // Now we check if it's a valid panel command, which is easily the most complex in the system. It starts with an optional label followed by the character ']', followed by an optional list of space separated classes and, optionally, by a colon followed by optional space separated positioning instructions: x offset, y offset, origin point, destination point, and the character '[' followed by the label of a previous panel to be used as anchor.
            m = l.match(/^(?:(.*))?]([^:]*)?(?::(-?[0-9.]+)?(?: (-?[0-9.]+)(?: (-?[0-9.]+)(?: (-?[0-9.]+))?)?)?(?:\s*\[(.*))?)?$/);
            if(m !== null){
                return{
                    type: 'panel',
                    labl: m[1],
                    clss: m[2] || '',
                    posi: $.map(m.slice(3, 7), function(n){
                        if(!isNaN(n)) {return parseFloat(n, 10);}
                    }),
                    ancr: m[7]
                };
            }

            // If it's not a panel, maybe it's an effect, which means it starts with a tilde, followed by the name of the effect followed by optional (space separated) arguments.
            m = l.match(/^~(\S*)(?:\s+(.*))?$/);
            if(m !== null){
                return{
                    type: 'effect',
                    comm: m[1],
                    args: m[2] && m[2].split(/\s+/)
            };
            }

            // Anything else is considered a chunk of text to be printed in the panel, optionally preceded by a space separated, comma terminated list of classes that apply to it.
            m = l.match(/^(?:([^:]*):)?(.*)$/);
            if(m !== null){

                // We default the classes list to empty string, for easier handling.
                if('undefined' === typeof m[1]){
                    m[1] = '';

                // If the first class in the classes list is prefixed with a plus sign, we will not create a new chunk, but try to append the text to an existing chunk of the same class.
                }else{
                    if('+' === m[1][0]){
                        m[1] = m[1].slice(1);
                        m[3] = true;
                    }
                }

                return{
                    type: 'chunk',
                    clss: m[1],
                    text: m[2],
                    apnd: m[3]
                };
            }
        }
    },

    // And finally the Canvas, which starts out as a simple jquery div
    Canvas = $('<div class="canvas"/>').
    // but quickly gets extended with all the properties and functions that it needs to become the dynamic drawing area we crave.
    extend({

        // First of all, we need a reference to the current panel. At this early point, it is initialized to a dummy panel that always returns position and size of 0 (so that we have a starting position) and can even automagically create the first panel for you if you try to add a chunk of text to it.
        cur: {
            position: function(){return {left: 0, top: 0};},
            outerWidth: function(){return 0;},
            outerHeight: function(){return 0;},
            point: function(){return {left: 0, top: 0};},
            chunk: function(clss, text){return Canvas.panel('','','',[]).chunk(clss, text);}
        },

        // We also have a bookmark to keep the index of the current line (set to -1 as we haven't even started)
        bookmark: -1,
        // and an undo stack
        backstack: [],
        // with its own undo function. This can be invoked with a function to store and an optional data object for that function (both will be closured) or empty, to execute the top of the stack.
        undo: function(f, d){
            if('function' === typeof f){
                this.backstack.push(
                    function(f, d){
                        return function(){f(d);};
                    }(f, d)
                );
            }else{

                // Note how we pop the double bubble at the end there.
                if(0 < this.backstack.length) this.backstack.pop()();
            }
        },

        // Next we need a dictionary of labeled panels, which can be referenced later for all sorts of cool stuff
        labels: {},
        // and we are ready to create and draw panels (that can create and draw chunks of text). The parameters for this are a string of space separated CSS classes (which define the look of the panes) and an array of up to four numbers which determines where it will be drawn (x offset, y offset, origin on anchor and destination on target - this will be made clearer later. I hope).
        panel: function(labl, clss, posi, ancr){

            // The panel is a jquery div which we extend
            var p = $('<div class="panel"/>').extend({
                // with a reference to its predecessor
                prev: this.cur
            // and append to the Canvas.
            }).addClass(clss).appendTo(this);

            // If it is labeled, we should keep it in the dictionary.
            if('undefined' !== typeof labl) {this.labels[labl] = p;}

            // Panels are positioned relative to an anchor panel. By default this is the previous one.
            p.anchor = (ancr && this.labels[ancr]) || p.prev;

            // But the anchor doesn't have to be the top-left corner of the panel (as is the CSS default). Instead, the corners are numbered clockwise from 0 to 3 starting at the top-left. Fractions are used to refer to points between the corners and all negative numbers refer to the center of the panel, just in case you ever wanna go there. Since this corner annotation is used both on the anchor panel and on the panel that is anchored to it (AKA "buoy panel"), we supply the panel with a function that translates it into CSS compatible coordinates.
            p.point = function(corner) {

                // First we need the size of the panel.
                var
                    w = p.outerWidth(),
                    h = p.outerHeight(),

                // Now we start with the base CSS location (top-left corner, which we call 0) and work from there.
                    o = {left: 0, top: 0};

                // Just remember a rectangle has 4 corners and you will be OK.
                corner %= 4;

                // Negative numbers denote the middle of the element.
                if(corner < 0){
                    o.left += w / 2;
                    o.top += h / 2;

                // 0 to 1 is the top edge.
                }else if(corner < 1){
                    o.left += corner * w;

                // 1 to 2 is the right edge.
                }else if(corner < 2){
                    o.left += w;
                    o.top += (corner - 1) * h;

                // 2 to 3 is the bottom edge.
                }else if(corner < 3){
                    o.left += (1 - corner + 2) * w;
                    o.top += h;

                // 3 to 4 is the left edge.
                }else if(corner < 4){
                    o.top += (1 - corner + 3) * h;
                }

                return o;
            };

            // By default, the new panel will be 5 pixels to the left of the anchor point
            p.left = 5;
            // while keeping the same height.
            p.top = 0;
            // The default anchor point is 1, which is the top-right corner,
            p.o = 1;
            // and the default destination point on the new ("buoy", remember?) panel defaults to 0, which is the top-left corner.
            p.d = 0;

            // But we override those defaults if we are supplied with arguments.
            if('undefined' !== typeof posi[0]){
                p.left = posi[0];
                if('undefined' !== typeof posi[1]){
                    p.top = posi[1];
                    if('undefined' !== typeof posi[2]){
                        p.o = posi[2];
                        if('undefined' !== typeof posi[3]){
                            p.d = posi[3];
                        }
                    }
                }
            }

            // Now we can calculate the desired left and top properties of the panel. This is a function because we will do it again every time the involved panels change, but don't worry, we will also call it as soon as we finish defining it.
            p.place = function(){

                // We get some basic numbers:
                var
                    // The position of the anchor panel,
                    o = p.anchor.position(),
                    // the position on that panel
                    a = p.anchor.point(p.o),
                    // and the offset between the destination point and the 0 point (top-left corner) of the new panel.
                    d = p.point(p.d);
                // and we set the position of the panel.
                p.css({
                    'left': (o.left + a.left + p.left - d.left) + 'px',
                    'top': (o.top + a.top + p.top - d.top) + 'px'
                });
            };
            p.place();

            // The panel creates and draws chunks of text with this function. It takes a string of space separated classes, which define how the chunk looks, and a string of text.
            p.chunk = function(clss, text){

                // In case you forgot, if a class is prefixed with a plus sign, we will try to append the text to a previous chunk of the same class.

                // The chunk is a jquery div which we extend
                var c = $('<div class="' + clss + '"/>').html(text).extend({
                    // with a reference to its containing panel
                    panel: p,
                    // and the chunk that preceded it,
                    prev: p.cur
                // and append to the panel.
                }).appendTo(p);

                // Once the chunk has been appended, we tell the containing panel to reposition itself. TODO This should probably be propagated to a chain of buoy panels.

                p.place();

                // And all that remains it to set the new chunk as the current and return it.
                return (p.cur = c);
            };

            // And all that remains it to set the new panel as the current and return it.
            return (this.cur = p);
        },

        // Now we can advance the story with go(1) or rewind it with go(-1). TODO In the future, we will accept greater numbers as arguments!
        go: function(dir){
            var
                // We keep a flag that sets when a scripted effect takes place, so that if none occur till the next stop command we center the current panel (at that time) as a default effect.
                center = true,

                // We also define a variable for the current line
                l,
                // and one for chunks that are to be appended to.
                o;

            // If we are told to go off the story borders, we do not go there. It is a silly place.
            if((this.bookmark + dir) < 0 || (this.bookmark + dir) >= Story.lines.length) return;

            // We are currently, by definition, on a stop command, so we move away from it and keep going forward or backward till the next stop command.
            for(this.bookmark += dir;
                'undefined' !== typeof (l = Story.line(this.bookmark));
                this.bookmark += dir){

                // If we are heading back, all we have to do is call undo to pop the top of the backstack and execute the function which we will have prepared in advance (time is an illusion, execution time doubly so).
                if(-1 === dir){
                    this.undo();
                    if('effect' === l.type) center = false;
                    continue;
                }
                // Otherwise we have some work.

                // If it's a panel,
                if('panel' === l.type){
                    // create it
                    this.panel(l.labl, l.clss, l.posi, l.ancr);
                    // and push an undo function that removes it
                    this.undo(function(){
                        // by removing the panel
                        Canvas.cur.remove();
                        // and setting the previous panel as current.
                        Canvas.cur = Canvas.cur.prev;
                    });

                // If it's a chunk,
                }else if('chunk' === l.type){

                    // If the chunk is meant to be appended, we go back through the chain of chunks, hoping to find one that shares the first class in the classes list with the chunk we want to add.
                    if(true === l.apnd){
                        o = this.cur.cur;
                        while('undefined' !== typeof o){
                            if(o.hasClass(l.clss.split(' ')[0])){
                                break;
                            }else{
                                o = o.prev;
                            }
                        }
                    }

                    // If it's a new chunk,
                    if('undefined' === typeof o){
                        // create it
                        this.cur.chunk(l.clss, l.text);
                        // and push an undo function that removes it
                        this.undo(function(){
                            // by removing the chunk
                            Canvas.cur.cur.remove();
                            // and setting the previous chunk as current.
                            Canvas.cur.cur = Canvas.cur.cur.prev;
                        });

                    // if it's an appendage,
                    }else{
                        // we know it might change the class attribute of whatever chunk it will be appended to, so we start by pushing a closured function that will chops the it off along with the classes it rode to town on. Note that we are using the html() function, as the text of the chunk may very well be.
                        this.undo(function(d){
                            d.o.attr('class', d.clss).html(d.txt);
                        },{o: o, clss: o.attr('class'), txt: o.html()});

                        // Only then do we append the appendage with its potentially new classes.
                        o.addClass(l.clss).append(l.text);

                        // And reset o.
                        o = undefined;
                    }

                    // After adding chunks we tell the containing panel to reposition itself. TODO This should probably be propagated to a chain of buoy panels, maybe also on some resize event.
                    this.cur.place();
                    // The same is true also after removing chunks and appendages, so we need to add that to the last item in the backstack. Closure again.
                    this.undo(function(o){
                        o();
                        Canvas.cur.place();
                    }, this.backstack.pop());

                // and if it's an effect, execute it. No need to worry about the backstack, the effects take care of it themselves (or at least should).
                }else if('effect' === l.type){

                    // An empty string means no effect,
                    if('' === l.comm){
                        // which doesn't mean it's not counted by the undo backstack, dammit!
                        this.undo(function(){;});
                    // 'pan' with two numbers pans the Canvas
                    }else if('pan' === l.comm){
                        this.pan(l.args[0], l.args[1]);
                    // and 'center' centers a panel.
                    }else if('center' === l.comm){
                        this.center(l.args[0]);
                    }

                    // Oh, and since we had an effect we don't need to auto center.
                    center = false;
                }
            }

            // If no effects were used, we either center the current panel, or, if we are heading backward, undo the centering we did when we came by forward.
            if(true === center){
                if(0 < dir){
                    this.center();
                }else{
                    this.undo();
                }
            }
        },

        // This is where we keep the built-in effects of the Canvas. TODO One day this might accept plugins, but ATM if you want your own effects you write them here and parse them above, in the effects section of the go function.

        // The most basic effect is sliding the Canvas to a new position (given as left and top CSS properties - the Canvas is relatively positioned within the Frame).
        pan: function(l, t, undo){
            var
                // So we get the starting (current) position of the Canvas
                startl = this.position().left,
                startt = this.position().top,
                // and figure out how far it has to go.
                diffl = Math.abs(startl - l),
                difft = Math.abs(startt - t);

            // The duration of the pan is a function of its magnitude, with safe minimum and maximum durations.
            diffl = Math.min(Math.max(diffl, 500), 5000) / 2000;
            difft = Math.min(Math.max(difft, 500), 5000) / 2000;

            // I'd love to use jquery's animate here, but jquery does not handle zoomed webkit windows very well, so I found jstween. TODO if I have jstween, instructions can come in ems, no?
            this.tween({
                left: {
                    start: startl,
                    stop: l,
                    time: 0,
                    duration: diffl,
                    effect: 'easeInOut'
                },
                top: {
                    start: startt,
                    stop: t,
                    time: 0,
                    duration: difft,
                    effect: 'easeInOut'
                },
                // The whole undo system is entirely asynchronic and it is entirely possible to call pan while another pan is running, with deterministically reproducible results (for javascript compatible values of deterministically), but in most cases this will only confuse the linear minded masses and should be handled with a queue or something. To make this easier we maintain the busy flag.
                onStart: function(){
                    Canvas.busy = true;
                },
                onStop: function(){
                    Canvas.busy = false;
                }
            }).play();

            // If this isn't already an undo, we push an undo pan to the undo stack.
            if(true !== undo) this.undo(function(d){
                Canvas.pan(d.l, d.t, true);
            }, {l: startl, t: startt});
        },

        // Only slightly more complex is this animation, which centers a panel (it defaults to the current panel, and centering it is the default effect).
        center: function(anchor){

            // If an anchor was given, we try to get it,
            if('string' === typeof anchor){
                anchor = this.labels[anchor];
            }
            // then we default to the current panel.
            if('undefined' === typeof anchor){
                anchor = this.cur;
            }

            // We obtain the position of the anchor in the Frame
            var
                p = anchor.position(),
                l = p.left,
                t = p.top;
            // and subtract it from half a Frame minus half the anchor.
            l = (0.5 * (Frame.innerWidth() - anchor.outerWidth())) - l;
            t = (0.5 * (Frame.innerHeight() - anchor.outerHeight())) - t;
            this.pan(l, t);
        }
    });

    // When the DOM is ready, we can put all the parts together.
    $(function(){

        // We get the Frame div, append the Canvas to it
        Frame = $('#panelz').append(Canvas).
        // And bind the mouse down event within the Frame to enable mouse drag which will pan the Canvas. Note that we return false on all the related events (mousedown, mousemove and mouseup) to make sure they do not propagate and, e.g., select pieces of the page.
        mousedown(function(e){

            // First we save the starting position of the mouse drag and the starting position of the Canvas (I'm trying to avoid jquery here, because, like I said, it is buggy with offset of zoomed pages).
            var
                startx = e.pageX,
                starty = e.pageY,
                cob = Canvas.get(0),
                l = parseFloat(cob.style.left.slice(0, -2), 10) || 0,
                t = parseFloat(cob.style.top.slice(0, -2), 10) || 0;

            // Then we bind a function so that when the mouse moves we calculate how much it moved since the drag started and modify the top and left CSS properties of the Canvas to move it along with the pointer.
            Frame.mousemove(function(e){
                Canvas.css({
                    left: parseFloat(l + (e.pageX - startx), 10) + 'px',
                    top: parseFloat(t + (e.pageY - starty), 10) + 'px'
                });
                return false;

            // Once the drag ends, we unbind the mouse move function.
            }).one('mouseup', function(e){
                Frame.off('mousemove');
                return false;
            });
            return false;
        });

        // Then we initialize the Story.
        Story.lines =

            // We find and detach the textarea inside the Frame which contains the script (TODO In the far future we may have an edit mode which brings it back)
            Frame.find('textarea').detach().
            // and split its text into an array of lines.
            text().split("\n");

    // Lastly we forward the story to a hard coded bookmark, so we don't have to page from the beginning every time, TODO In the future, this value will be taken from a cookie, or the cursor position in the textarea. Maybe it will even get its own global object.
    for(var x = 0; x < 1; (x++)) Canvas.go(1);
    // and bind the keyboard driven interface.
    }).keydown(function(e){

        // For now, we ignore keypresses when the Canvas is busy. TODO In the future we will do something cleverer, like a queue or acceleration.
        if(Canvas.busy) return true;

        // Right arrow and space go forward.
        if(39 === e.which || 32 === e.which){
            Canvas.go(1);

        // Left arrow goes back.
        }else if(37 === e.which){
            Canvas.go(-1);

        // Anything else will log itself, to make it easier for me to bind new keys to new functions, and return true so that someone else will handle it.
        }else{
            console.log('unknown key', e.which);
            return true;
        }

        // If the keystroke was recognized as a command and handled, we return false, to stop propagation.
        return false;
    });

    window.Canvas = Canvas;

// Then we call the anonymous function we just declared and everything should just run. Simple and fun.
}());
