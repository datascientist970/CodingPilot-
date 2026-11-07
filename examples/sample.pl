use strict;
use warnings;

sub greet {
    my ($name) = @_;
    return "Hello, $name";
}

sub unused_sub {
    return 1;
}

my $message = greet("World");
print $message, "\n";
my $unused_var = 42;
