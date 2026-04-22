package cmd

import (
	"errors"
	"fmt"
	"os"

	"line-cli-go/cmd/content"
	"line-cli-go/cmd/message"
	"line-cli-go/cmd/profile"
	"line-cli-go/cmd/quota"
	"line-cli-go/cmd/richmenu"
	_ "line-cli-go/cmd/richmenu/alias" // registers alias subgroup
	_ "line-cli-go/cmd/richmenu/batch" // registers batch subgroup
	"line-cli-go/cmd/token"
	"line-cli-go/cmd/webhook"
	"line-cli-go/internal/config"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

var cfgFile string

var rootCmd = &cobra.Command{
	Use:           "line-cli-go",
	Short:         "LINE Messaging API CLI client for line-api-mock",
	SilenceErrors: true,
	SilenceUsage:  true,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		var ce *config.ClientError
		if errors.As(err, &ce) {
			fmt.Fprintf(os.Stderr, "Error: %s\n", ce.Msg)
			os.Exit(2)
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func mustBindPFlag(key string, flag *pflag.Flag) {
	if err := viper.BindPFlag(key, flag); err != nil {
		panic(fmt.Sprintf("binding flag %s: %v", key, err))
	}
}

func init() {
	cobra.OnInitialize(initConfig)

	rootCmd.AddCommand(content.ContentCmd)
	rootCmd.AddCommand(message.MessageCmd)
	rootCmd.AddCommand(profile.ProfileCmd)
	rootCmd.AddCommand(quota.QuotaCmd)
	rootCmd.AddCommand(richmenu.RichMenuCmd)
	rootCmd.AddCommand(token.TokenCmd)
	rootCmd.AddCommand(webhook.WebhookCmd)

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default: .line-cli.yaml)")
	rootCmd.PersistentFlags().String("base-url", "", "mock server base URL")
	rootCmd.PersistentFlags().String("channel-id", "", "LINE channel ID")
	rootCmd.PersistentFlags().String("channel-secret", "", "LINE channel secret")
	rootCmd.PersistentFlags().String("access-token", "", "channel access token")
	rootCmd.PersistentFlags().Bool("json", false, "output as JSON")

	mustBindPFlag("base_url", rootCmd.PersistentFlags().Lookup("base-url"))
	mustBindPFlag("channel_id", rootCmd.PersistentFlags().Lookup("channel-id"))
	mustBindPFlag("channel_secret", rootCmd.PersistentFlags().Lookup("channel-secret"))
	mustBindPFlag("access_token", rootCmd.PersistentFlags().Lookup("access-token"))
	mustBindPFlag("json", rootCmd.PersistentFlags().Lookup("json"))
}

func initConfig() {
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		viper.SetConfigName(".line-cli")
		viper.SetConfigType("yaml")
		viper.AddConfigPath(".")
		home, err := os.UserHomeDir()
		if err == nil {
			viper.AddConfigPath(home)
		}
	}

	viper.SetEnvPrefix("LINE")
	viper.AutomaticEnv()
	viper.SetDefault("base_url", "http://localhost:3000")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			fmt.Fprintf(os.Stderr, "Error reading config: %s\n", err)
		}
	}
}
